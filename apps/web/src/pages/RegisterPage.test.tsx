import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { validateNewPassword, validateRegister } from '../auth/register-form';
import { apiError, fakeApi, json, type FakeHandler } from '../test/fake-api';
import { renderPage } from '../test/render';
import { OtpVerifyPage } from './OtpVerifyPage';
import { RegisterPage } from './RegisterPage';

function setup(register: FakeHandler) {
  const api = fakeApi({ 'POST /auth/register': register });
  const page = renderPage(
    <Routes>
      <Route path="/dang-ky" element={<RegisterPage />} />
      <Route path="/xac-minh-otp" element={<OtpVerifyPage />} />
    </Routes>,
    { route: '/dang-ky', path: '/*' },
  );
  return { ...page, api };
}

type User = ReturnType<typeof setup>['user'];
const submit = () => screen.getByRole('button', { name: /Tạo tài khoản/ });

async function fill(user: User, password = 'MatKhau123', confirm = password) {
  await user.type(screen.getByRole('textbox', { name: /Họ và tên/ }), 'Trần An');
  await user.type(screen.getByRole('textbox', { name: /Email/ }), 'an@email.vn');
  await user.type(screen.getByLabelText(/^Mật khẩu/), password);
  await user.type(screen.getByLabelText(/Nhập lại mật khẩu/), confirm);
  await user.click(submit());
}

describe('register-form', () => {
  it('kiểm họ tên, email, độ dài và thành phần mật khẩu, khớp mật khẩu', () => {
    expect(validateNewPassword('abc1')).toBe('Mật khẩu cần từ 8 đến 72 ký tự.');
    expect(validateNewPassword('chiconchu')).toBe('Mật khẩu cần có cả chữ và số.');
    expect(validateNewPassword('12345678')).toBe('Mật khẩu cần có cả chữ và số.');
    expect(validateNewPassword('MatKhau123')).toBeUndefined();
    expect(
      validateRegister({
        fullName: ' A ',
        email: 'x',
        password: 'MatKhau123',
        confirmPassword: 'khac',
      }),
    ).toMatchObject({
      fullName: 'Họ tên cần từ 2 đến 100 ký tự.',
      email: 'Email không đúng định dạng.',
      confirmPassword: 'Mật khẩu nhập lại không khớp.',
    });
  });
});

describe('RegisterPage', () => {
  it('dữ liệu sai → báo lỗi, không gọi API', async () => {
    const { user, api } = setup(() => json({}));
    await fill(user, 'MatKhau123', 'KhacNhau123');

    expect(screen.getByText('Mật khẩu nhập lại không khớp.')).toBeInTheDocument();
    expect(api.requests).toHaveLength(0);
  });

  it('đăng ký thành công → sang bước nhập mã, không gửi mã lần hai, không gửi confirmPassword', async () => {
    const { user, api, location } = setup(() =>
      json({ email: 'an@email.vn', expiresInSeconds: 300 }, 201),
    );
    await fill(user);

    await waitFor(() => expect(location()).toBe('/xac-minh-otp'));
    expect(await screen.findByRole('group', { name: 'Mã OTP' })).toBeInTheDocument();
    expect(api.to('POST /auth/register')[0]!.body).toEqual({
      fullName: 'Trần An',
      email: 'an@email.vn',
      password: 'MatKhau123',
    });
    expect(api.to('POST /auth/otp/send')).toHaveLength(0);
  });

  it('email đã đăng ký → hiện link đăng nhập và quên mật khẩu', async () => {
    const { user } = setup(() =>
      apiError(409, 'EMAIL_ALREADY_EXISTS', 'Email này đã được đăng ký.'),
    );
    await fill(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('Email này đã được đăng ký.');
    expect(screen.getByRole('link', { name: 'Quên mật khẩu' })).toBeInTheDocument();
  });

  it('bị giới hạn 429 → banner, không hiện lỗi form', async () => {
    const { user } = setup(() =>
      apiError(429, 'TOO_MANY_REQUESTS', 'Bạn thao tác quá nhanh.', { retryAfterSeconds: 60 }),
    );
    await fill(user);

    expect(await screen.findByText('Cảnh báo giới hạn thao tác')).toBeInTheDocument();
  });
});
