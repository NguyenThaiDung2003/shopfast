import { act, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { rateLimitStore } from '../api/rate-limit';
import { apiError, fakeApi, json, type FakeHandler } from '../test/fake-api';
import { renderPage } from '../test/render';
import { LoginPage } from './LoginPage';
import { OtpVerifyPage } from './OtpVerifyPage';

/** JWT giả: client chỉ đọc payload. */
function token(role: string) {
  const payload = btoa(JSON.stringify({ sub: 'u1', role, exp: Date.now() / 1000 + 900 }));
  return `h.${payload.replace(/=+$/, '')}.s`;
}
const authResult = (role: string) => ({
  accessToken: token(role),
  refreshToken: 'r',
  tokenType: 'Bearer',
  expiresIn: 900,
  user: { id: 'u1', email: 'a@shopfast.local', fullName: 'An', role, createdAt: '' },
});
const locked = (seconds: number) =>
  new Response(
    JSON.stringify({
      statusCode: 429,
      code: 'LOGIN_LOCKED',
      message: 'Đăng nhập tạm bị khoá.',
      details: { retryAfterSeconds: seconds },
    }),
    { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': `${seconds}` } },
  );

function setup(login: FakeHandler, route = '/dang-nhap') {
  const api = fakeApi({ 'POST /auth/login': login });
  return { ...renderPage(<LoginPage />, { route, path: '/dang-nhap' }), api };
}

type User = ReturnType<typeof setup>['user'];
const emailBox = () => screen.getByRole('textbox', { name: /Email/ });
const passwordBox = () => screen.getByLabelText(/Mật khẩu/);
const submit = () => screen.getByRole('button', { name: /Đăng nhập ShopFast/ });

async function fill(user: User, email = 'a@shopfast.local') {
  await user.type(emailBox(), email);
  await user.type(passwordBox(), 'MatKhau123');
  await user.click(submit());
}

describe('LoginPage', () => {
  it('validate: thiếu và sai định dạng email, không gọi API', async () => {
    const { user, api } = setup(() => json(authResult('CUSTOMER')));
    await user.click(submit());
    expect(screen.getByText('Vui lòng nhập email.')).toBeInTheDocument();
    expect(screen.getByText('Vui lòng nhập mật khẩu.')).toBeInTheDocument();

    await user.type(emailBox(), 'abc');
    await user.click(submit());
    expect(screen.getByText('Email không đúng định dạng.')).toBeInTheDocument();
    expect(api.requests).toHaveLength(0);

    await user.type(emailBox(), '@shopfast.local');
    expect(screen.getByText('Định dạng hợp lệ')).toBeInTheDocument();
  });

  it('đăng nhập đúng → về `next`; `next` ra ngoài bị chặn', async () => {
    const first = setup(() => json(authResult('CUSTOMER')), '/dang-nhap?next=%2Fgio-hang');
    await fill(first.user);
    await waitFor(() => expect(first.location()).toBe('/gio-hang'));
  });

  it('`next` trỏ sang site khác → về trang của vai trò', async () => {
    const { user, location } = setup(
      () => json(authResult('CUSTOMER')),
      '/dang-nhap?next=%2F%2Fevil.example',
    );
    await fill(user);
    await waitFor(() => expect(location()).toBe('/'));
  });

  it('sai mật khẩu (401) → hiện thông điệp API, không khoá nút', async () => {
    const { user } = setup(() => apiError(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu sai.'));
    await fill(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Email hoặc mật khẩu sai.');
    expect(submit()).toBeEnabled();
  });

  it('LOGIN_LOCKED → khung "Tài khoản tạm khoá", khoá nút; đổi email thì mở; hết giờ thì mở', async () => {
    const { user } = setup(() => locked(300));
    await fill(user);

    expect(await screen.findByText('Tài khoản tạm khoá')).toBeInTheDocument();
    expect(screen.getByText('Đăng nhập tạm bị khoá.')).toBeInTheDocument();
    expect(screen.getByText(/Thử lại sau: 0?5:00|Thử lại sau: 04:5/)).toBeInTheDocument();
    expect(submit()).toBeDisabled();

    await user.type(emailBox(), 'x');
    expect(submit()).toBeEnabled();
    await user.keyboard('{Backspace}');
    expect(submit()).toBeDisabled();

    act(() => rateLimitStore.clear());
    expect(submit()).toBeEnabled();
  });

  it('429 chung → "Cảnh báo giới hạn thao tác", khoá nút dù đổi email', async () => {
    const { user } = setup(() =>
      apiError(429, 'TOO_MANY_REQUESTS', 'Bạn thao tác quá nhanh.', { retryAfterSeconds: 42 }),
    );
    await fill(user);

    expect(await screen.findByText('Cảnh báo giới hạn thao tác')).toBeInTheDocument();
    expect(submit()).toBeDisabled();
    await user.type(emailBox(), 'x');
    expect(submit()).toBeDisabled();
  });

  it('link OTP mang theo email đã nhập nhưng không để email trên URL', async () => {
    fakeApi({});
    const { user, location } = renderPage(
      <Routes>
        <Route path="/dang-nhap" element={<LoginPage />} />
        <Route path="/xac-minh-otp" element={<OtpVerifyPage />} />
      </Routes>,
      { route: '/dang-nhap', path: '/*' },
    );
    await user.type(emailBox(), 'a@shopfast.local');
    await user.click(screen.getByRole('link', { name: 'Xác minh email bằng mã OTP' }));

    expect(location()).toBe('/xac-minh-otp');
    expect(emailBox()).toHaveValue('a@shopfast.local');
  });
});
