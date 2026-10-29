import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../database/redis.constants';

const STATS_KEY = 'cache:stats';

// Chỉ xoá lock nếu vẫn là của mình: lock đã hết hạn và bị request khác lấy thì không đụng vào.
const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

// Với mỗi khoá version: xoá entry của version hiện tại (nếu có tiền tố), rồi INCR.
// Một lệnh EVAL duy nhất → nguyên tử và được ghi xuống socket ngay khi gọi (ADR-0007).
const INVALIDATE_SCRIPT = `
for i, versionKey in ipairs(KEYS) do
  local version = redis.call('GET', versionKey) or '0'
  if ARGV[i] ~= '' then
    redis.call('DEL', ARGV[i] .. version)
  end
  redis.call('INCR', versionKey)
end
return #KEYS`;

export interface VersionBump {
  versionKey: string;
  /** Tiền tố khoá dữ liệu; khoá của version hiện tại = tiền tố + version. Bỏ trống → chỉ INCR. */
  entryPrefix?: string;
}

/** Truy cập Redis cho cache. Mọi lệnh có thể ném lỗi (mất kết nối, timeout) – CacheService bắt. */
@Injectable()
export class CacheRepository {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.redis.set(key, value, 'PX', ttlMs);
  }

  async acquireLock(key: string, token: string, ttlMs: number): Promise<boolean> {
    return (await this.redis.set(key, token, 'PX', ttlMs, 'NX')) === 'OK';
  }

  async releaseLock(key: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token);
  }

  /** Không được có `await` trước lệnh EVAL: lệnh phải rời process ngay trong lúc gọi. */
  async bumpVersions(bumps: VersionBump[]): Promise<void> {
    await this.redis.eval(
      INVALIDATE_SCRIPT,
      bumps.length,
      ...bumps.map((b) => b.versionKey),
      ...bumps.map((b) => b.entryPrefix ?? ''),
    );
  }

  async incrementStat(field: string): Promise<void> {
    await this.redis.hincrby(STATS_KEY, field, 1);
  }

  getStats(): Promise<Record<string, string>> {
    return this.redis.hgetall(STATS_KEY);
  }

  async resetStats(): Promise<void> {
    await this.redis.del(STATS_KEY);
  }
}
