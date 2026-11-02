import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, fakeApi, json, type FakeHandler } from '../test/fake-api';
import { renderPage } from '../test/render';
import { ForgotPasswordPage } from './ForgotPasswordPage';

const EMAIL = 'an@email.vn';

function setup(reset: FakeHandler = () => new Response(null, { status: 204 })) {
  const api = fakeApi({
    'POST /auth/otp/send': () => json({ expiresInSeconds: 300 }, 202),
    'POST /auth/password/reset': reset,
  });
  const page = renderPage(<ForgotPasswordPage />, {
    route: { pathname: '/quen-mat-khau', state: { email: EMAIL } },
    path: '/quen-mat-khau',
  });
  return { ...page, api };
}

type User = ReturnType<typeof setup>['user'];
const submit = () => screen.getByRole('button', { name: 'Đặt lại mật khẩu' });

async function toResetStep(user: User) {
  await user.click(screen.getByRole('button', { name: /Gửi mã đặt lại/ }));
  await screen.findByRole('group', { name: 'Mã OTP' });
}

async function fillReset(user: User, password = 'MatKhauMoi1', confirm = password) {
  await user.click(screen.getByRole('textbox', { name: 'Chữ số 1' }));
  await user.paste('123456');
  await user.type(screen.getByLabelText(/^Mật khẩu mới/), password);
  await user.type(screen.getByLabelText(/Nhập lại mật khẩu mới/), confirm);
  await user.click(submit());
}

describe('ForgotPasswordPage', () => {
  it('gửi mã purpose RESET_PASSWORD, không khẳng định email có tài khoản', async () => {
    const { user, api } = setup();
    await toResetStep(user);

    expect(api.to('POST /auth/otp/send')[0]!.body).toEqual({
      email: EMAIL,
      purpose: 'RESET_PASSWORD',
    });
    expect(screen.getByText(/có tài khoản, mã/)).toBeInTheDocument();
  });

  it('đặt lại thành công → màn hình hoàn tất', async () => {
    const { user, api } = setup();
    await toResetStep(user);
    await fillReset(user);

    expect(await screen.findByRole('heading', { name: 'Đã đặt lại mật khẩu' })).toBeInTheDocument();
    expect(api.to('POST /auth/password/reset')[0]!.body).toEqual({
      email: EMAIL,
      code: '123456',
      newPassword: 'MatKhauMoi1',
    });
  });

  it('mật khẩu yếu hoặc nhập lại sai → không gọi API', async () => {
    const { user, api } = setup();
    await toResetStep(user);
    await fillReset(user, 'yeu', 'khac');

    expect(screen.getByText('Mật khẩu cần từ 8 đến 72 ký tự.')).toBeInTheDocument();
    expect(screen.getByText('Mật khẩu nhập lại không khớp.')).toBeInTheDocument();
    expect(api.to('POST /auth/password/reset')).toHaveLength(0);
  });

  it('mã sai → báo lỗi; sai quá nhiều lần → khoá nút', async () => {
    let locked = false;
    const { user } = setup(() =>
      locked
        ? apiError(429, 'OTP_TOO_MANY_ATTEMPTS', 'Bạn đã nhập sai quá nhiều lần.')
        : apiError(400, 'OTP_INVALID', 'Mã xác thực không đúng hoặc đã hết hạn.'),
    );
    await toResetStep(user);
    await fillReset(user);
    expect(await screen.findByText('Mã xác thực không đúng hoặc đã hết hạn.')).toBeInTheDocument();

    locked = true;
    await user.click(screen.getByRole('textbox', { name: 'Chữ số 1' }));
    await user.paste('654321');
    await user.click(submit());
    expect(await screen.findByText('Mã đã bị huỷ, vui lòng gửi lại mã mới.')).toBeInTheDocument();
    expect(submit()).toBeDisabled();
  });
});
