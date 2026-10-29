import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import { CacheService, TTL_JITTER } from '../cache/cache.service';
import {
  CATALOG_VERSION_KEY,
  listKey,
  listQueryHash,
  productKey,
  productKeyPrefix,
  productVersionKey,
} from './catalog-cache.keys';
import type { ProductDetail } from './catalog.repository';
import type { ProductPage } from './catalog.service';
import { ListProductsQuery } from './dto/list-products.query';

/** Cache sản phẩm (ADR-0007): chi tiết theo version riêng từng sản phẩm, danh sách theo version chung. */
@Injectable()
export class CatalogCacheService {
  private readonly productTtlSeconds: number;
  private readonly listTtlSeconds: number;

  constructor(
    private readonly cache: CacheService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.productTtlSeconds = config.get('CACHE_PRODUCT_TTL_SECONDS', { infer: true });
    this.listTtlSeconds = config.get('CACHE_LIST_TTL_SECONDS', { infer: true });
  }

  product(id: number, load: () => Promise<ProductDetail | null>): Promise<ProductDetail | null> {
    return this.cache.getOrLoad(
      {
        namespace: 'product',
        versionKey: productVersionKey(id),
        key: (version) => productKey(id, version),
        ttlSeconds: this.productTtlSeconds,
      },
      load,
    );
  }

  list(query: ListProductsQuery, load: () => Promise<ProductPage>): Promise<ProductPage> {
    const hash = listQueryHash(query);
    return this.cache.getOrLoad(
      {
        namespace: 'product_list',
        versionKey: CATALOG_VERSION_KEY,
        key: (version) => listKey(version, hash),
        ttlSeconds: this.listTtlSeconds,
        // Bộ lọc không ra sản phẩm nào: cache TTL ngắn như "không tồn tại".
        isEmpty: (page) => page.items.length === 0,
      },
      load,
    );
  }

  /**
   * Xoá key chi tiết + INCR version sản phẩm và version danh sách. Promise trả về chỉ để test;
   * lệnh đã được gửi tới Redis ngay khi hàm này chạy.
   */
  invalidateProduct(id: number): Promise<void> {
    const longestTtlMs = Math.max(this.productTtlSeconds, this.listTtlSeconds) * 1000;
    return this.cache.invalidate(
      [
        { versionKey: productVersionKey(id), entryPrefix: productKeyPrefix(id) },
        { versionKey: CATALOG_VERSION_KEY },
      ],
      Math.ceil(longestTtlMs * (1 + TTL_JITTER)),
    );
  }
}
