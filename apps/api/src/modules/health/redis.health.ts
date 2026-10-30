import { Inject, Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../database/redis.constants';

/** PING trên REDIS_CLIENT (fail-fast, có commandTimeout) kèm giới hạn thời gian riêng. */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    super();
  }

  async pingCheck(key: string, timeoutMs: number): Promise<HealthIndicatorResult> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.redis.ping(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timeout of ${timeoutMs}ms exceeded`)),
            timeoutMs,
          );
        }),
      ]);
      return this.getStatus(key, true);
    } catch (error) {
      throw new HealthCheckError(
        `${key} is not available: ${(error as Error).message}`,
        this.getStatus(key, false),
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
