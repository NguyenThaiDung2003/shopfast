import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import type { EnvironmentVariables } from '../../config/env.validation';
import { CacheService, CacheSpec } from '../cache/cache.service';
import { CATALOG_VERSION_KEY, listQueryHash } from './catalog-cache.keys';
import { CatalogCacheListener } from './catalog-cache.listener';
import { CatalogCacheService } from './catalog-cache.service';
import { ProductSort } from './catalog.query';
import { ListProductsQuery } from './dto/list-products.query';
import { ProductUpdatedEvent } from './events/product-updated.event';

function query(overrides: Partial<ListProductsQuery> = {}): ListProductsQuery {
  return Object.assign(new ListProductsQuery(), overrides);
}

describe('listQueryHash', () => {
  it('thứ tự tham số không đổi key', () => {
    expect(listQueryHash(query({ categoryId: 1, brandId: 2 }))).toBe(
      listQueryHash(Object.assign(new ListProductsQuery(), { brandId: 2, categoryId: 1 })),
    );
  });

  it('default đã áp → không truyền page/limit/sort giống truyền giá trị mặc định', () => {
    expect(listQueryHash(query())).toBe(
      listQueryHash(query({ page: 1, limit: 20, sort: ProductSort.NEWEST })),
    );
  });

  it('mỗi trường lọc/trang/sắp xếp khác nhau → key khác nhau', () => {
    const base = listQueryHash(query());
    const variants = [
      { categoryId: 1 },
      { brandId: 1 },
      { minPrice: 0 },
      { maxPrice: 100 },
      { page: 2 },
      { limit: 50 },
      { sort: ProductSort.PRICE_ASC },
    ].map((o) => listQueryHash(query(o)));

    expect(new Set([base, ...variants]).size).toBe(variants.length + 1);
  });

  it('trường lạ (không ảnh hưởng kết quả) không làm phình số key', () => {
    const withJunk = Object.assign(query(), { utm_source: 'fb' });
    expect(listQueryHash(withJunk)).toBe(listQueryHash(query()));
  });
});

describe('CatalogCacheService', () => {
  let cache: { getOrLoad: jest.Mock; invalidate: jest.Mock };
  let service: CatalogCacheService;
  const config = {
    get: (key: string) => ({ CACHE_PRODUCT_TTL_SECONDS: 300, CACHE_LIST_TTL_SECONDS: 60 })[key],
  } as unknown as ConfigService<EnvironmentVariables, true>;

  beforeEach(() => {
    cache = {
      getOrLoad: jest.fn((_spec: unknown, load: () => Promise<unknown>) => load()),
      invalidate: jest.fn().mockResolvedValue(undefined),
    };
    service = new CatalogCacheService(cache as unknown as CacheService, config);
  });

  it('chi tiết: version riêng từng sản phẩm, TTL sản phẩm', async () => {
    const load = jest.fn().mockResolvedValue(null);

    await service.product(42, load);

    const spec = cache.getOrLoad.mock.calls[0]![0] as CacheSpec<unknown>;
    expect(spec).toMatchObject({
      namespace: 'product',
      versionKey: 'cache:product:42:ver',
      ttlSeconds: 300,
    });
    expect(spec.key('3')).toBe('cache:product:42:v3');
    expect(load).toHaveBeenCalled();
  });

  it('danh sách: version chung + hash bộ lọc, trang rỗng coi là "rỗng"', async () => {
    const q = query({ categoryId: 1 });

    await service.list(q, async () => ({
      items: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    }));

    const spec = cache.getOrLoad.mock.calls[0]![0] as CacheSpec<{ items: unknown[] }>;
    expect(spec).toMatchObject({
      namespace: 'product_list',
      versionKey: CATALOG_VERSION_KEY,
      ttlSeconds: 60,
    });
    expect(spec.key('5')).toBe(`cache:products:v5:${listQueryHash(q)}`);
    expect(spec.isEmpty!({ items: [] })).toBe(true);
    expect(spec.isEmpty!({ items: [1] })).toBe(false);
  });

  it('invalidateProduct: xoá key chi tiết + INCR version sản phẩm và version danh sách', async () => {
    await service.invalidateProduct(42);

    expect(cache.invalidate).toHaveBeenCalledWith(
      [
        { versionKey: 'cache:product:42:ver', entryPrefix: 'cache:product:42:v' },
        { versionKey: CATALOG_VERSION_KEY },
      ],
      // TTL dài nhất (300s) + jitter 15%: đủ để mọi entry có thể đã cũ tự hết hạn.
      345_000,
    );
  });
});

describe('CatalogCacheListener', () => {
  it('product.updated → làm mất hiệu lực đúng sản phẩm, ngay trong lời gọi', () => {
    const catalogCache = { invalidateProduct: jest.fn().mockResolvedValue(undefined) };
    const listener = new CatalogCacheListener(catalogCache as unknown as CatalogCacheService);

    void listener.handleProductUpdated(
      new ProductUpdatedEvent(
        7,
        'SKU-7',
        { price: { from: 2, to: 1 } },
        {
          id: 'a',
          role: Role.ADMIN,
        },
      ),
    );

    // Không chờ microtask: invalidation phải được khởi động đồng bộ.
    expect(catalogCache.invalidateProduct).toHaveBeenCalledWith(7);
  });
});
