import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import type { EnvironmentVariables } from '../config/env.validation';

/**
 * Chỉ tầng repository được inject PrismaService.
 * Không gọi $connect() khi khởi động: Prisma kết nối lười ở truy vấn đầu tiên,
 * nên API vẫn lên được khi DB tạm thời chưa sẵn sàng (suy giảm có kiểm soát).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super({ datasourceUrl: config.get('DATABASE_URL', { infer: true }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
