import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { EnvironmentVariables } from '../config/env.validation';
import { REDIS_CLIENT } from './redis.constants';

/**
 * Client Redis dùng chung. Fail-fast thay vì xếp hàng lệnh khi Redis mất kết nối:
 * nơi gọi nhận lỗi ngay và tự quyết định suy giảm (ví dụ OTP trả 503), API không bị treo.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>): Redis => {
        const logger = new Logger('Redis');
        const client = new Redis(config.get('REDIS_URL', { infer: true }), {
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          // Lệnh treo (Redis quá tải/mạng chập chờn) không được kéo dài request: quá hạn → lỗi.
          commandTimeout: config.get('REDIS_COMMAND_TIMEOUT_MS', { infer: true }),
          connectTimeout: 2_000,
          retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
        });
        client.on('error', (error: Error) => logger.warn(`Redis error: ${error.message}`));
        client.connect().catch(() => undefined);
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Hook CUỐI khi tắt (ADR-0012): request và job đang chạy vẫn dùng được Redis tới lúc này.
   * Đang kết nối thì QUIT (gửi hết lệnh dở), không thì ngắt luôn.
   */
  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status !== 'ready') {
      this.redis.disconnect();
      return;
    }
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
