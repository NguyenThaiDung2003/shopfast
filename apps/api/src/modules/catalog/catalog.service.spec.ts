import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import { InventoryQuery, InventorySort, StockLevel } from './dto/inventory.query';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Role } from '@prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../auth/auth.types';
import { CatalogCacheService } from './catalog-cache.service';
import { ProductSort } from './catalog.query';
import {
  CatalogRepository,
  ApplyPatchResult,
  ProductDetail,
  ProductListItem,
  ProductValues,
} from './catalog.repository';
import { CatalogService, diff } from './catalog.service';
import { ListProductsQuery } from './dto/list-products.query';
import { PRODUCT_UPDATED, ProductUpdatedEvent } from './events/product-updated.event';

const admin: AuthUser = { id: 'admin-1', role: Role.ADMIN };
const warehouse: AuthUser = { id: 'wh-1', role: Role.WAREHOUSE };

const listItem: ProductListItem = {
  imageUrl: null,
  compareAtPrice: null,
  soldCount: 0,
  id: 1,
  sku: 'SF-DT-0001',
  name: 'Điện thoại Samsung Pro 5',
  slug: 'dien-thoai-samsung-pro-5-sf-dt-0001',
  price: 12_490_000,
  stock: 10,
  category: { id: 1, name: 'Điện thoại', slug: 'dien-thoai' },
  brand: { id: 2, name: 'Samsung', slug: 'samsung' },
};
const detail: ProductDetail = { ...listItem, description: 'Mô tả', updatedAt: new Date() };
const current = { price: 12_490_000, stock: 10, imageUrl: null, compareAtPrice: null };

function query(overrides: Partial<ListProductsQuery> = {}): ListProductsQuery {
  return Object.assign(new ListProductsQuery(), overrides);
}

describe('CatalogService', () => {
  let repository: jest.Mocked<
    Pick<
      CatalogRepository,
      | 'findPage'
      | 'findById'
      | 'applyPatch'
      | 'listCategories'
      | 'listBrands'
      | 'findInventoryPage'
      | 'inventorySummary'
    >
  >;
  let emitter: { emit: jest.Mock };
  let cache: { list: jest.Mock; product: jest.Mock; categories: jest.Mock; brands: jest.Mock };
  let service: CatalogService;

  /** Giả lập applyPatch: áp patch lên tồn kho hiện tại như câu UPDATE thật. */
  function mockApplyPatch(state: ProductValues = current) {
    repository.applyPatch.mockImplementation(async (_id, patch): Promise<ApplyPatchResult> => {
      const stock = patch.stock ?? state.stock + (patch.stockDelta ?? 0);
      if (stock < 0) return { status: 'insufficient_stock', available: state.stock };
      const after = {
        price: patch.price ?? state.price,
        stock,
        imageUrl: patch.imageUrl === undefined ? state.imageUrl : patch.imageUrl,
        compareAtPrice:
          patch.compareAtPrice === undefined ? state.compareAtPrice : patch.compareAtPrice,
      };
      repository.findById.mockResolvedValue({ ...detail, ...after });
      return { status: 'updated', sku: 'SF-DT-0001', before: state, after };
    });
  }

  beforeEach(() => {
    repository = {
      findPage: jest.fn().mockResolvedValue({ items: [listItem], total: 45 }),
      findById: jest.fn(),
      applyPatch: jest.fn(),
      listCategories: jest.fn(),
      listBrands: jest.fn(),
      findInventoryPage: jest.fn(),
      inventorySummary: jest.fn(),
    };
    emitter = { emit: jest.fn() };
    // Mặc định cache luôn trượt: gọi thẳng loader (logic cache test ở cache.service.spec.ts).
    cache = {
      list: jest.fn((_query: unknown, load: () => Promise<unknown>) => load()),
      product: jest.fn((_id: unknown, load: () => Promise<unknown>) => load()),
      categories: jest.fn((load: () => Promise<unknown>) => load()),
      brands: jest.fn((load: () => Promise<unknown>) => load()),
    };
    service = new CatalogService(
      repository as unknown as CatalogRepository,
      cache as unknown as CatalogCacheService,
      emitter as unknown as EventEmitter2,
      { get: jest.fn().mockReturnValue(5) } as unknown as ConfigService<EnvironmentVariables, true>,
    );
  });

  describe('inventory', () => {
    it('đọc thẳng DB (không qua cache), truyền bộ lọc + ngưỡng, kèm số liệu toàn kho', async () => {
      repository.findInventoryPage.mockResolvedValue({
        items: [{ ...listItem, updatedAt: new Date() }],
        total: 26,
      });
      repository.inventorySummary.mockResolvedValue({
        totalSkus: 40,
        lowStock: 3,
        outOfStock: 1,
        stockValue: 9_000_000,
      });

      const page = await service.inventory(
        Object.assign(new InventoryQuery(), {
          page: 2,
          q: 'sf-dt',
          categoryId: 3,
          stockLevel: StockLevel.LOW,
        }),
      );

      expect(repository.findInventoryPage).toHaveBeenCalledWith(
        { q: 'sf-dt', categoryId: 3, stockLevel: StockLevel.LOW, threshold: 5 },
        InventorySort.STOCK_ASC,
        25,
        25,
      );
      expect(repository.inventorySummary).toHaveBeenCalledWith(5);
      expect(page.meta).toEqual({ page: 2, limit: 25, total: 26, totalPages: 2 });
      expect(page.summary).toEqual({
        totalSkus: 40,
        lowStock: 3,
        outOfStock: 1,
        stockValue: 9_000_000,
        lowStockThreshold: 5,
      });
      expect(cache.list).not.toHaveBeenCalled();
    });
  });

  describe('list – lọc và phân trang', () => {
    it('mặc định: trang 1, 20 sản phẩm, sắp mới nhất', async () => {
      const result = await service.list(query());

      expect(repository.findPage).toHaveBeenCalledWith(
        { categoryId: undefined, brandId: undefined, minPrice: undefined, maxPrice: undefined },
        ProductSort.NEWEST,
        0,
        20,
      );
      expect(result.meta).toEqual({ page: 1, limit: 20, total: 45, totalPages: 3 });
      expect(result.items).toEqual([listItem]);
    });

    it('page/limit → offset, truyền đủ bộ lọc và kiểu sắp xếp', async () => {
      await service.list(
        query({
          page: 3,
          limit: 10,
          categoryId: 1,
          brandId: 2,
          minPrice: 1000,
          maxPrice: 5000,
          sort: ProductSort.PRICE_DESC,
        }),
      );

      expect(repository.findPage).toHaveBeenCalledWith(
        { categoryId: 1, brandId: 2, minPrice: 1000, maxPrice: 5000 },
        ProductSort.PRICE_DESC,
        20,
        10,
      );
    });

    it('trang vượt quá tổng → items rỗng nhưng meta vẫn đúng', async () => {
      repository.findPage.mockResolvedValue({ items: [], total: 45 });

      const result = await service.list(query({ page: 10, limit: 20 }));

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.any(Object),
        ProductSort.NEWEST,
        180,
        20,
      );
      expect(result).toEqual({
        items: [],
        meta: { page: 10, limit: 20, total: 45, totalPages: 3 },
      });
    });

    it('tổng chia hết cho limit không sinh trang thừa', async () => {
      repository.findPage.mockResolvedValue({ items: [listItem], total: 40 });

      const result = await service.list(query({ limit: 20 }));

      expect(result.meta.totalPages).toBe(2);
    });

    it('không có sản phẩm → totalPages = 0', async () => {
      repository.findPage.mockResolvedValue({ items: [], total: 0 });

      const result = await service.list(query());

      expect(result.meta.totalPages).toBe(0);
    });

    it('minPrice = maxPrice hợp lệ', async () => {
      await expect(service.list(query({ minPrice: 5000, maxPrice: 5000 }))).resolves.toBeDefined();
    });

    it('khoảng giá ngược → INVALID_PRICE_RANGE, không truy vấn DB', async () => {
      const promise = service.list(query({ minPrice: 9000, maxPrice: 1000 }));

      await expect(promise).rejects.toBeInstanceOf(AppException);
      await expect(promise).rejects.toMatchObject({ code: 'INVALID_PRICE_RANGE' });
      expect(repository.findPage).not.toHaveBeenCalled();
      expect(cache.list).not.toHaveBeenCalled();
    });

    it('đi qua cache với đúng query; trúng cache thì không truy vấn DB', async () => {
      const cached = { items: [listItem], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } };
      cache.list.mockResolvedValue(cached);
      const q = query({ categoryId: 1 });

      await expect(service.list(q)).resolves.toBe(cached);
      expect(cache.list).toHaveBeenCalledWith(q, expect.any(Function));
      expect(repository.findPage).not.toHaveBeenCalled();
    });
  });

  describe('listCategories / listBrands', () => {
    const facets = [{ id: 1, name: 'Điện thoại', slug: 'dien-thoai', productCount: 45 }];

    it('danh mục: đọc qua cache, cache trượt thì gọi repository', async () => {
      repository.listCategories.mockResolvedValue(facets);
      await expect(service.listCategories()).resolves.toEqual(facets);
      expect(cache.categories).toHaveBeenCalledTimes(1);
      expect(repository.listCategories).toHaveBeenCalledTimes(1);
    });

    it('thương hiệu: cache trúng thì không gọi DB', async () => {
      cache.brands.mockResolvedValue(facets);
      await expect(service.listBrands()).resolves.toEqual(facets);
      expect(repository.listBrands).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('trả chi tiết sản phẩm', async () => {
      repository.findById.mockResolvedValue(detail);

      await expect(service.findOne(1)).resolves.toBe(detail);
    });

    it('không tồn tại → PRODUCT_NOT_FOUND', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
    });

    it('trúng cache → không truy vấn DB', async () => {
      cache.product.mockResolvedValue(detail);

      await expect(service.findOne(1)).resolves.toBe(detail);
      expect(cache.product).toHaveBeenCalledWith(1, expect.any(Function));
      expect(repository.findById).not.toHaveBeenCalled();
    });

    it('cache giữ "không tồn tại" → vẫn 404, không truy vấn DB', async () => {
      cache.product.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
      expect(repository.findById).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('admin đổi giá → lưu và phát product.updated kèm giá cũ/mới', async () => {
      mockApplyPatch();

      const product = await service.update(1, { price: 9_990_000 }, admin);

      expect(repository.applyPatch).toHaveBeenCalledWith(1, {
        price: 9_990_000,
        stock: undefined,
        stockDelta: undefined,
      });
      expect(product.price).toBe(9_990_000);
      expect(emitter.emit).toHaveBeenCalledTimes(1);
      const [name, event] = emitter.emit.mock.calls[0]!;
      expect(name).toBe(PRODUCT_UPDATED);
      expect(event).toBeInstanceOf(ProductUpdatedEvent);
      expect(event).toMatchObject({
        productId: 1,
        sku: 'SF-DT-0001',
        changes: { price: { from: 12_490_000, to: 9_990_000 } },
        updatedBy: admin,
      });
      expect(event.changes.stock).toBeUndefined();
      // Response PATCH đọc thẳng DB, không qua cache.
      expect(cache.product).not.toHaveBeenCalled();
    });

    it('warehouse nhập thêm hàng bằng stockDelta', async () => {
      mockApplyPatch();

      const product = await service.update(1, { stockDelta: 15 }, warehouse);

      expect(product.stock).toBe(25);
      expect(emitter.emit.mock.calls[0]![1].changes).toEqual({ stock: { from: 10, to: 25 } });
    });

    it('warehouse đặt tồn kho tuyệt đối khi kiểm kê', async () => {
      mockApplyPatch();

      const product = await service.update(1, { stock: 3 }, warehouse);

      expect(product.stock).toBe(3);
    });

    it('warehouse đổi giá → 403 FORBIDDEN_FIELD, không chạm DB', async () => {
      await expect(service.update(1, { price: 1 }, warehouse)).rejects.toMatchObject({
        code: 'FORBIDDEN_FIELD',
      });
      expect(repository.applyPatch).not.toHaveBeenCalled();
    });

    it('warehouse đổi giá gốc hoặc ảnh, kể cả gửi null → 403 FORBIDDEN_FIELD', async () => {
      for (const dto of [
        { compareAtPrice: 1 },
        { compareAtPrice: null },
        { imageUrl: '/a.png' },
        { imageUrl: null },
      ]) {
        await expect(service.update(1, dto, warehouse)).rejects.toMatchObject({
          code: 'FORBIDDEN_FIELD',
        });
      }
      expect(repository.applyPatch).not.toHaveBeenCalled();
    });

    it('admin sửa giá gốc và ảnh → truyền xuống repository, phát event để xoá cache', async () => {
      mockApplyPatch();

      await service.update(1, { compareAtPrice: 15_000_000, imageUrl: '/a.png' }, admin);

      expect(repository.applyPatch).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ compareAtPrice: 15_000_000, imageUrl: '/a.png' }),
      );
      expect(emitter.emit.mock.calls[0]![1].changes).toEqual({
        imageUrl: { from: null, to: '/a.png' },
        compareAtPrice: { from: null, to: 15_000_000 },
      });
    });

    it('null xoá giá gốc và ảnh, khác với không gửi', async () => {
      mockApplyPatch({ ...current, imageUrl: '/a.png', compareAtPrice: 15_000_000 });

      await service.update(1, { compareAtPrice: null, imageUrl: null }, admin);

      expect(repository.applyPatch.mock.calls[0]![1]).toMatchObject({
        compareAtPrice: null,
        imageUrl: null,
      });
      expect(emitter.emit.mock.calls[0]![1].changes).toEqual({
        imageUrl: { from: '/a.png', to: null },
        compareAtPrice: { from: 15_000_000, to: null },
      });
    });

    it('giá gốc không lớn hơn giá bán → 400 INVALID_COMPARE_AT_PRICE, không phát event', async () => {
      repository.applyPatch.mockResolvedValue({
        status: 'invalid_compare_at_price',
        price: 12_490_000,
      });

      await expect(service.update(1, { compareAtPrice: 1 }, admin)).rejects.toMatchObject({
        code: 'INVALID_COMPARE_AT_PRICE',
        status: 400,
        details: { price: 12_490_000 },
      });
      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it('body rỗng → EMPTY_UPDATE', async () => {
      await expect(service.update(1, {}, admin)).rejects.toMatchObject({ code: 'EMPTY_UPDATE' });
      expect(repository.applyPatch).not.toHaveBeenCalled();
    });

    it('gửi cả stock và stockDelta → STOCK_CONFLICT', async () => {
      await expect(service.update(1, { stock: 5, stockDelta: 1 }, admin)).rejects.toMatchObject({
        code: 'STOCK_CONFLICT',
      });
    });

    it('trừ quá tồn kho → 409 INSUFFICIENT_STOCK kèm số còn lại, không phát event', async () => {
      mockApplyPatch();

      await expect(service.update(1, { stockDelta: -11 }, warehouse)).rejects.toMatchObject({
        code: 'INSUFFICIENT_STOCK',
        userMessage: 'Tồn kho không đủ: hiện còn 10, không thể trừ 11.',
      });
      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it('giá trị mới giống cũ → không phát event', async () => {
      mockApplyPatch();

      await service.update(1, { price: current.price, stock: current.stock }, admin);

      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it('không tồn tại → PRODUCT_NOT_FOUND', async () => {
      repository.applyPatch.mockResolvedValue({ status: 'not_found' });

      await expect(service.update(999, { stock: 1 }, admin)).rejects.toMatchObject({
        code: 'PRODUCT_NOT_FOUND',
      });
      expect(emitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('update – expectedStock', () => {
    it('tồn đã đổi → 409 STOCK_CHANGED kèm số hiện tại, không phát event', async () => {
      repository.applyPatch.mockResolvedValue({ status: 'stock_changed', current: 7 });

      await expect(
        service.update(1, { stock: 20, expectedStock: 10 }, warehouse),
      ).rejects.toMatchObject({ code: 'STOCK_CHANGED', status: 409, details: { current: 7 } });
      expect(repository.applyPatch).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ stock: 20, expectedStock: 10 }),
      );
      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it('expectedStock không kèm stock → 400', async () => {
      await expect(
        service.update(1, { stockDelta: 1, expectedStock: 10 }, warehouse),
      ).rejects.toMatchObject({ code: 'STOCK_CONFLICT' });
      expect(repository.applyPatch).not.toHaveBeenCalled();
    });
  });

  describe('diff', () => {
    it('chỉ giữ trường thực sự đổi', () => {
      expect(diff(current, { ...current, stock: 11 })).toEqual({
        stock: { from: 10, to: 11 },
      });
      expect(diff(current, current)).toEqual({});
    });
  });
});
