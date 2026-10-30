// Form đăng nhập: validate trước khi gọi API (POST /auth/login chỉ nhận email + mật khẩu).

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailFormat(email: string): boolean {
  return EMAIL.test(email.trim());
}

export interface LoginErrors {
  email?: string;
  password?: string;
}

export function validateLogin(email: string, password: string): LoginErrors {
  const errors: LoginErrors = {};
  if (!email.trim()) errors.email = 'Vui lòng nhập email.';
  else if (!isEmailFormat(email)) errors.email = 'Email không đúng định dạng.';
  if (!password) errors.password = 'Vui lòng nhập mật khẩu.';
  return errors;
}
