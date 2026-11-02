import { api } from '../api/client';

export type OtpPurpose = 'VERIFY_EMAIL' | 'RESET_PASSWORD';

export function sendOtp(email: string, purpose: OtpPurpose): Promise<{ expiresInSeconds: number }> {
  return api.post('/auth/otp/send', { email, purpose }, { auth: false });
}

export function verifyOtp(email: string, code: string): Promise<{ verified: true }> {
  return api.post('/auth/otp/verify', { email, purpose: 'VERIFY_EMAIL', code }, { auth: false });
}

export interface ResetPasswordInput {
  email: string;
  code: string;
  newPassword: string;
}

export function resetPassword(input: ResetPasswordInput): Promise<void> {
  return api.post<void>('/auth/password/reset', input, { auth: false });
}
