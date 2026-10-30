import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import type { EnvironmentVariables } from '../config/env.validation';

/**
 * Chỉ tầng repository được inject PrismaService.
 * Không gọi $connect() khi khởi động: Prisma kết nối lười ở truy vấn đầu tiên,
 * nên API vẫn lên được khi DB tạm thời chưa sẵn sàng (suy giảm có kiểm soát).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown {
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super({ datasourceUrl: config.get('DATABASE_URL', { infer: true }) });
  }

  /**
   * Hook CUỐI khi tắt (sau khi HTTP server đã đóng và worker đã xong job – ADR-0012).
   * Không dùng onModuleDestroy: hook đó chạy trước khi Nest ngừng nhận request.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
