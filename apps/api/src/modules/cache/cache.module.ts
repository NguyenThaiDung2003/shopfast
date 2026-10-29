import { Module } from '@nestjs/common';
import { CacheController } from './cache.controller';
import { CacheRepository } from './cache.repository';
import { CacheService } from './cache.service';

/** Cache-aside dùng chung trên Redis (F04, ADR-0007). */
@Module({
  controllers: [CacheController],
  providers: [CacheService, CacheRepository],
  exports: [CacheService],
})
export class CacheModule {}
