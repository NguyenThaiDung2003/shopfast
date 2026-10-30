import { api } from '../api/client';

/** Mục đích của mã; `RESET_PASSWORD` chưa dùng vì API chưa có endpoint đặt lại mật khẩu. */
const PURPOSE = 'VERIFY_EMAIL';

export function sendOtp(email: string): Promise<{ expiresInSeconds: number }> {
  return api.post('/auth/otp/send', { email, purpose: PURPOSE }, { auth: false });
}

export function verifyOtp(email: string, code: string): Promise<{ verified: true }> {
  return api.post('/auth/otp/verify', { email, purpose: PURPOSE, code }, { auth: false });
}
