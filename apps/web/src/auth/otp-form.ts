// Logic thuần của trang xác thực OTP.

export const OTP_LENGTH = 6;
/** API không có cooldown riêng; web chờ 30 giây giữa hai lần gửi, API chặn thật bằng 429. */
export const RESEND_SECONDS = 30;

/** `nguyen.minh@email.vn` → `ng***@email.vn` (không lộ toàn bộ email trên màn hình). */
export function maskEmail(email: string): string {
  const [name = '', domain = ''] = email.trim().split('@');
  return `${name.slice(0, 2)}***@${domain}`;
}

export function validateOtpCode(code: string): string | undefined {
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code)
    ? undefined
    : `Vui lòng nhập đủ ${OTP_LENGTH} chữ số.`;
}

/** Dán mã từ ô `index`: chỉ giữ chữ số, nối vào phần trước, cắt theo độ dài mã. */
export function distributeDigits(value: string, index: number, text: string): string {
  return (value.slice(0, index) + text.replace(/\D/g, '')).slice(0, OTP_LENGTH);
}
