import type { EnvironmentVariables } from '../../config/env.validation';

/** Hạn mức chung, áp cho mọi request và đếm gộp trên toàn API (không theo từng route). */
export const GLOBAL_POLICY = 'global';

/** Hạn mức riêng, chặt hơn, chỉ áp cho route gắn `@RateLimit(tên)`. */
export const RATE_LIMIT_POLICIES = {
  login: 'RATE_LIMIT_LOGIN',
  otpSend: 'RATE_LIMIT_OTP_SEND',
  promoOrder: 'RATE_LIMIT_PROMO_ORDER',
} as const satisfies Record<string, keyof EnvironmentVariables>;

export type RateLimitPolicy = keyof typeof RATE_LIMIT_POLICIES;

export interface Limit {
  limit: number;
  ttlMs: number;
}

/** "10/60" → 10 request mỗi 60 giây. Joi đã kiểm cú pháp khi khởi động. */
export function parseLimit(value: string): Limit {
  const [limit, seconds] = value.split('/').map(Number);
  if (!Number.isInteger(limit) || !Number.isInteger(seconds) || limit! < 1 || seconds! < 1) {
    throw new Error(`Invalid rate limit "${value}", expected "<limit>/<seconds>"`);
  }
  return { limit: limit!, ttlMs: seconds! * 1000 };
}
