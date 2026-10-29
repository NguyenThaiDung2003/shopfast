import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type Redis from 'ioredis';
import type { EnvironmentVariables } from '../../config/env.validation';
import { REDIS_CLIENT } from '../../database/redis.constants';
import { AppThrottlerGuard } from './app-throttler.guard';
import { GLOBAL_POLICY, parseLimit, RATE_LIMIT_POLICIES } from './rate-limit.policies';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * Rate limit (F03, ADR-0008). Phải import SAU AuthModule trong AppModule: guard toàn cục chạy
 * theo thứ tự đăng ký, guard này cần `request.user` do JwtAuthGuard gắn để đếm theo userId.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (config: ConfigService<EnvironmentVariables, true>, redis: Redis) => {
        const throttler = (name: string, value: string) => {
          const { limit, ttlMs } = parseLimit(value);
          return { name, limit, ttl: ttlMs };
        };
        return {
          throttlers: [
            throttler(GLOBAL_POLICY, config.get('RATE_LIMIT_GLOBAL', { infer: true })),
            ...Object.entries(RATE_LIMIT_POLICIES).map(([name, envKey]) =>
              throttler(name, config.get(envKey, { infer: true })),
            ),
          ],
          storage: new RedisThrottlerStorage(redis),
          // Header Retry-After do HttpExceptionFilter đặt từ details (một chỗ cho mọi 429).
          setHeaders: false,
        };
      },
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class RateLimitModule {}
