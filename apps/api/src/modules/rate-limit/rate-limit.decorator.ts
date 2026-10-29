import { SetMetadata } from '@nestjs/common';
import type { RateLimitPolicy } from './rate-limit.policies';

export const RATE_LIMIT_POLICY_KEY = 'rateLimitPolicy';

/**
 * Áp thêm hạn mức riêng (chặt hơn hạn mức chung) cho route. Các route cùng policy dùng
 * chung một bộ đếm theo tracker (ADR-0008).
 */
export const RateLimit = (policy: RateLimitPolicy) => SetMetadata(RATE_LIMIT_POLICY_KEY, policy);
