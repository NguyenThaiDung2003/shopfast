import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../database/redis.constants';

const WARN_INTERVAL_MS = 10_000;

// Cửa sổ cố định: INCR + PEXPIRE khi key mới. Vượt hạn mức thì đặt khoá chặn blockDuration.
// Một lệnh EVAL → nguyên tử, đúng khi nhiều instance API cùng đếm trên một Redis.
// KEYS: [hits, block]  ARGV: [ttlMs, limit, blockDurationMs]  → { hits, hitsTtlMs, blockTtlMs }
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local hitsTtl = redis.call('PTTL', KEYS[1])
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl <= 0 and hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blockTtl = tonumber(ARGV[3])
end
return { hits, hitsTtl, blockTtl }`;

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

const toSeconds = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

/**
 * Storage của @nestjs/throttler trên Redis dùng chung (`REDIS_CLIENT`). Redis lỗi hoặc timeout
 * → cho qua (không đếm) và log cảnh báo: rate limit không được làm sập cả API (ADR-0008).
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private lastWarnAt = 0;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): Promise<ThrottlerStorageRecord> {
    try {
      const [hits, hitsTtlMs, blockTtlMs] = (await this.redis.eval(
        INCREMENT_SCRIPT,
        2,
        key,
        `${key}:block`,
        ttl,
        limit,
        blockDuration,
      )) as [number, number, number];
      const isBlocked = blockTtlMs > 0;
      return {
        totalHits: hits,
        timeToExpire: toSeconds(hitsTtlMs),
        isBlocked,
        timeToBlockExpire: isBlocked ? toSeconds(blockTtlMs) : 0,
      };
    } catch (error) {
      this.warn(error);
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
  }

  private warn(error: unknown): void {
    const now = Date.now();
    if (now - this.lastWarnAt < WARN_INTERVAL_MS) return;
    this.lastWarnAt = now;
    this.logger.warn(
      `Rate limit storage unavailable, allowing request: ${(error as Error).message}`,
    );
  }
}
