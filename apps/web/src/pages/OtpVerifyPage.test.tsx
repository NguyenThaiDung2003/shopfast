import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { distributeDigits, maskEmail, validateOtpCode } from '../auth/otp-form';
import { apiError, fakeApi, json, type FakeHandler } from '../test/fake-api';
import { renderPage } from '../test/render';
import { OtpVerifyPage } from './OtpVerifyPage';

const EMAIL = 'nguyen.minh@email.vn';
const ROUTE = { pathname: '/xac-minh-otp', state: { email: EMAIL } };

function setup(routes: Record<string, FakeHandler> = {}, route: typeof ROUTE | string = ROUTE) {
  const api = fakeApi({
    'POST /auth/otp/send': () => json({ expiresInSeconds: 300 }, 202),
    'POST /auth/otp/verify': () => json({ verified: true }),
    ...routes,
  });
  return { ...renderPage(<OtpVerifyPage />, { route, path: '/xac-minh-otp' }), api };
}

type User = ReturnType<typeof setup>['user'];
const box = (n: number) => screen.getByRole('textbox', { name: `Chữ số ${n}` });
const confirm = () => screen.getByRole('button', { name: /Xác nhận & Tiếp tục/ });

async function toCodeStep(user: User) {
  await user.click(screen.getByRole('button', { name: /Gửi mã xác thực/ }));
  await screen.findByRole('group', { name: 'Mã OTP' });
}

async function pasteCode(user: User, code = '123456') {
  await user.click(box(1));
  await user.paste(code);
}

describe('otp-form', () => {
  it('che email, kiểm 6 chữ số, phân bổ khi dán', () => {
    expect(maskEmail(EMAIL)).toBe('ng***@email.vn');
    expect(validateOtpCode('12345')).toBe('Vui lòng nhập đủ 6 chữ số.');
    expect(validateOtpCode('123456')).toBeUndefined();
    expect(distributeDigits('12', 2, '3 4-5678')).toBe('123456');
  });
});

describe('OtpVerifyPage', () => {
  it('email sai → báo lỗi, không gửi; đúng → gửi với purpose VERIFY_EMAIL', async () => {
    const { user, api } = setup({}, '/xac-minh-otp');
    await user.click(screen.getByRole('button', { name: /Gửi mã xác thực/ }));
    expect(screen.getByText('Vui lòng nhập email.')).toBeInTheDocument();
    expect(api.requests).toHaveLength(0);

    await user.type(screen.getByRole('textbox', { name: /Email/ }), EMAIL);
    await toCodeStep(user);
    expect(api.to('POST /auth/otp/send')[0]!.body).toEqual({
      email: EMAIL,
      purpose: 'VERIFY_EMAIL',
    });
    expect(screen.getByText('ng***@email.vn')).toBeInTheDocument();
    expect(screen.getByText('05:00')).toBeInTheDocument();
  });

  it('dán mã rồi xác nhận → màn hình thành công', async () => {
    const { user, api } = setup();
    await toCodeStep(user);
    await pasteCode(user);
    expect(box(6)).toHaveValue('6');
    await user.click(confirm());

    expect(await screen.findByRole('heading', { name: 'Mã xác thực hợp lệ' })).toBeInTheDocument();
    expect(api.to('POST /auth/otp/verify')[0]!.body).toEqual({
      email: EMAIL,
      purpose: 'VERIFY_EMAIL',
      code: '123456',
    });
  });

  it('mã thiếu → không gọi API', async () => {
    const { user, api } = setup();
    await toCodeStep(user);
    await user.click(box(1));
    await user.keyboard('12');
    await user.click(confirm());
    expect(screen.getByText('Vui lòng nhập đủ 6 chữ số.')).toBeInTheDocument();
    expect(api.to('POST /auth/otp/verify')).toHaveLength(0);
  });

  it('mã sai → báo lỗi, xoá mã, focus ô đầu', async () => {
    const { user } = setup({
      'POST /auth/otp/verify': () =>
        apiError(400, 'OTP_INVALID', 'Mã xác thực không đúng hoặc đã hết hạn.'),
    });
    await toCodeStep(user);
    await pasteCode(user);
    await user.click(confirm());

    expect(await screen.findByText('Mã xác thực không đúng hoặc đã hết hạn.')).toBeInTheDocument();
    expect(box(1)).toHaveValue('');
    await waitFor(() => expect(box(1)).toHaveFocus());
  });

  it('sai quá nhiều lần → khoá nhập, chỉ gửi mã mới được', async () => {
    let locked = true;
    const { user } = setup({
      'POST /auth/otp/verify': () =>
        locked
          ? apiError(429, 'OTP_TOO_MANY_ATTEMPTS', 'Bạn đã nhập sai quá nhiều lần.')
          : json({ verified: true }),
    });
    await toCodeStep(user);
    await pasteCode(user);
    await user.click(confirm());

    expect(await screen.findByText('Mã đã bị huỷ, vui lòng gửi lại mã mới.')).toBeInTheDocument();
    expect(box(1)).toBeDisabled();
    expect(confirm()).toBeDisabled();
    locked = false;
  });

  it('hết hạn → khoá nhập và nút xác nhận', async () => {
    const { user } = setup({
      'POST /auth/otp/send': () => json({ expiresInSeconds: 1 }, 202),
    });
    await toCodeStep(user);
    expect(
      await screen.findByText('Mã đã hết hạn, vui lòng gửi lại mã mới.', {}, { timeout: 2500 }),
    ).toBeInTheDocument();
    expect(confirm()).toBeDisabled();
    expect(box(1)).toBeDisabled();
  });

  it('gửi lại mã: khoá 30 giây, hết giờ gửi được và đặt lại mã', async () => {
    const { user, api } = setup();
    await toCodeStep(user);
    await pasteCode(user, '12');
    expect(screen.getByRole('button', { name: /Gửi lại mã \d+s/ })).toBeDisabled();

    const real = Date.now;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => real() + 31_000);
    const resend = await screen.findByRole('button', { name: 'Gửi lại mã' }, { timeout: 2000 });
    await user.click(resend);
    await waitFor(() => expect(api.to('POST /auth/otp/send')).toHaveLength(2));
    spy.mockRestore();
    await waitFor(() => expect(box(1)).toHaveValue(''));
  });

  it('gửi bị 429 → banner giới hạn, chưa sang bước nhập mã; 503 → thông điệp server', async () => {
    const limited = setup({
      'POST /auth/otp/send': () =>
        apiError(429, 'TOO_MANY_REQUESTS', 'Bạn thao tác quá nhanh.', { retryAfterSeconds: 60 }),
    });
    await limited.user.click(screen.getByRole('button', { name: /Gửi mã xác thực/ }));
    expect(await screen.findByText('Cảnh báo giới hạn thao tác')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Mã OTP' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gửi mã xác thực/ })).toBeDisabled();
  });

  it('dịch vụ OTP lỗi 503 → hiện thông điệp server', async () => {
    const { user } = setup({
      'POST /auth/otp/send': () =>
        apiError(503, 'SERVICE_UNAVAILABLE', 'Dịch vụ gửi mã đang gián đoạn.'),
    });
    await user.click(screen.getByRole('button', { name: /Gửi mã xác thực/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Dịch vụ gửi mã đang gián đoạn.');
  });
});
