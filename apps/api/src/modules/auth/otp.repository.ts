import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../database/redis.constants';

export interface StoredOtp {
  codeHash: string;
  attempts: number;
}

/** Lưu OTP trong Redis: hash { codeHash, attempts } với TTL, tự biến mất khi hết hạn. */
@Injectable()
export class OtpRepository {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async save(key: string, codeHash: string, ttlSeconds: number): Promise<void> {
    const results = await this.redis
      .multi()
      .del(key)
      .hset(key, { codeHash, attempts: 0 })
      .expire(key, ttlSeconds)
      .exec();
    const failed = results?.find(([error]) => error);
    if (!results || failed) throw failed?.[0] ?? new Error('Redis transaction aborted');
  }

  async find(key: string): Promise<StoredOtp | null> {
    const data = await this.redis.hgetall(key);
    if (!data.codeHash) return null;
    return { codeHash: data.codeHash, attempts: Number(data.attempts ?? 0) };
  }

  /** Tăng số lần nhập sai, giữ nguyên TTL. */
  incrementAttempts(key: string): Promise<number> {
    return this.redis.hincrby(key, 'attempts', 1);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
