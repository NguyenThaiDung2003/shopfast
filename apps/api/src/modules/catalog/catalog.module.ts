import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { CatalogCacheListener } from './catalog-cache.listener';
import { CatalogCacheService } from './catalog-cache.service';
import { CatalogController } from './catalog.controller';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';

@Module({
  imports: [CacheModule],
  controllers: [CatalogController],
  providers: [CatalogService, CatalogRepository, CatalogCacheService, CatalogCacheListener],
  // Trợ lý AI (F06) tra tồn kho qua CatalogService.stockBySku.
  exports: [CatalogService],
})
export class CatalogModule {}
