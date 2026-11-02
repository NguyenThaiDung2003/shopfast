// Form đăng ký và mật khẩu mới: khớp rule của RegisterDto ở API.
import { isEmailFormat } from './login-form';

export interface RegisterValues {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export type RegisterErrors = Partial<Record<keyof RegisterValues, string>>;

export function validateNewPassword(password: string): string | undefined {
  if (!password) return 'Vui lòng nhập mật khẩu.';
  if (password.length < 8 || password.length > 72) return 'Mật khẩu cần từ 8 đến 72 ký tự.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Mật khẩu cần có cả chữ và số.';
  }
  return undefined;
}

export function validateConfirmPassword(
  password: string,
  confirmPassword: string,
): string | undefined {
  return password === confirmPassword ? undefined : 'Mật khẩu nhập lại không khớp.';
}

export function validateRegister(values: RegisterValues): RegisterErrors {
  const errors: RegisterErrors = {};
  const fullName = values.fullName.trim();
  if (fullName.length < 2 || fullName.length > 100)
    errors.fullName = 'Họ tên cần từ 2 đến 100 ký tự.';
  if (!values.email.trim()) errors.email = 'Vui lòng nhập email.';
  else if (!isEmailFormat(values.email)) errors.email = 'Email không đúng định dạng.';
  errors.password = validateNewPassword(values.password);
  errors.confirmPassword = validateConfirmPassword(values.password, values.confirmPassword);
  return errors;
}

export function hasErrors(errors: RegisterErrors): boolean {
  return Object.values(errors).some(Boolean);
}
