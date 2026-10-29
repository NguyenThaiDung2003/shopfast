import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../database/redis.constants';

/** Số lần đã bị khoá được nhớ 24h kể từ lần khoá gần nhất – để lần khoá sau dài hơn. */
const STRIKES_TTL_MS = 24 * 60 * 60 * 1000;

// Ghi nhận một lần sai, nguyên tử. Đang khoá → trả TTL khoá (không đếm thêm).
// Đủ số lần sai → tăng "strike", khoá theo bước tương ứng (bước cuối lặp lại), xoá bộ đếm.
// KEYS: [fail, strikes, lock]  ARGV: [maxFailures, windowMs, strikesTtlMs, step1Ms, step2Ms, …]
// → thời gian khoá (ms), 0 nếu chưa khoá.
const RECORD_FAILURE_SCRIPT = `
local locked = redis.call('PTTL', KEYS[3])
if locked > 0 then
  return locked
end
local failures = redis.call('INCR', KEYS[1])
if failures == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
if failures < tonumber(ARGV[1]) then
  return 0
end
local strikes = redis.call('INCR', KEYS[2])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
local step = math.min(strikes, #ARGV - 3)
local lockMs = tonumber(ARGV[3 + step])
redis.call('SET', KEYS[3], '1', 'PX', lockMs)
redis.call('DEL', KEYS[1])
return lockMs`;

/**
 * Bộ đếm đăng nhập sai theo email mục tiêu (ADR-0008). Key dùng sha256(email) để Redis không
 * chứa email thô. Mọi lệnh có thể ném lỗi (mất kết nối, timeout) – LoginAttemptsService bắt.
 */
@Injectable()
export class LoginAttemptsRepository {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Thời gian khoá còn lại (ms), 0 nếu không khoá. */
  async lockTtlMs(email: string): Promise<number> {
    return Math.max(0, await this.redis.pttl(loginAttemptKeys(email).lock));
  }

  /** Thời gian khoá (ms) nếu lần sai này làm/đang khoá, 0 nếu chưa. */
  async recordFailure(
    email: string,
    options: { maxFailures: number; windowMs: number; lockoutStepsMs: number[] },
  ): Promise<number> {
    const { fail, strikes, lock } = loginAttemptKeys(email);
    const result = await this.redis.eval(
      RECORD_FAILURE_SCRIPT,
      3,
      fail,
      strikes,
      lock,
      options.maxFailures,
      options.windowMs,
      STRIKES_TTL_MS,
      ...options.lockoutStepsMs,
    );
    return Number(result);
  }

  async reset(email: string): Promise<void> {
    const { fail, strikes, lock } = loginAttemptKeys(email);
    await this.redis.del(fail, strikes, lock);
  }
}

/** Key Redis của một email; dùng khi cần mở khoá tay (ADR-0008 → Xử lý khi sự cố). */
export function loginAttemptKeys(email: string): { fail: string; strikes: string; lock: string } {
  const id = createHash('sha256').update(email).digest('hex');
  return {
    fail: `auth:login:fail:${id}`,
    strikes: `auth:login:strikes:${id}`,
    lock: `auth:login:lock:${id}`,
  };
}
