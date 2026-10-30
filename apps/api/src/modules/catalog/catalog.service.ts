import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Role } from '@prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { Page, toPage } from '../../common/pagination';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { AuthUser } from '../auth/auth.types';
import { CatalogCacheService } from './catalog-cache.service';
import {
  CatalogFacet,
  CatalogRepository,
  InventoryItem,
  InventorySummary,
  ProductDetail,
  ProductListItem,
  ProductStock,
  ProductValues,
} from './catalog.repository';
import { InventoryQuery } from './dto/inventory.query';
import { ListProductsQuery } from './dto/list-products.query';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  PRODUCT_UPDATED,
  ProductChangeSet,
  ProductUpdatedEvent,
} from './events/product-updated.event';

export type ProductPage = Page<ProductListItem>;

export type InventoryPage = Page<InventoryItem> & {
  summary: InventorySummary & { lowStockThreshold: number };
};

const PRICE_EDITOR_ROLES: readonly Role[] = [Role.ADMIN];

@Injectable()
export class CatalogService {
  constructor(
    private readonly catalogRepository: CatalogRepository,
    private readonly catalogCache: CatalogCacheService,
    private readonly eventEmitter: EventEmitter2,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /**
   * Tồn kho cho nhân viên kho: đọc thẳng DB (không qua cache) vì người dùng vừa sửa tồn phải
   * thấy số mới ngay. `summary` là số liệu toàn kho, không phụ thuộc bộ lọc.
   */
  async inventory(query: InventoryQuery): Promise<InventoryPage> {
    const { page, limit, q, categoryId, stockLevel, sort } = query;
    const threshold = this.config.get('LOW_STOCK_THRESHOLD', { infer: true });
    const [{ items, total }, summary] = await Promise.all([
      this.catalogRepository.findInventoryPage(
        { q, categoryId, stockLevel, threshold },
        sort,
        (page - 1) * limit,
        limit,
      ),
      this.catalogRepository.inventorySummary(threshold),
    ]);
    return {
      ...toPage(items, total, page, limit),
      summary: { ...summary, lowStockThreshold: threshold },
    };
  }

  async list(query: ListProductsQuery): Promise<ProductPage> {
    const { page, limit, sort, categoryId, brandId, minPrice, maxPrice } = query;

    if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'INVALID_PRICE_RANGE',
        'Khoảng giá không hợp lệ: giá thấp nhất phải nhỏ hơn hoặc bằng giá cao nhất.',
      );
    }

    return this.catalogCache.list(query, async () => {
      const { items, total } = await this.catalogRepository.findPage(
        { categoryId, brandId, minPrice, maxPrice },
        sort,
        (page - 1) * limit,
        limit,
      );
      return toPage(items, total, page, limit);
    });
  }

  /** Danh mục kèm số sản phẩm (bộ lọc trang danh sách). */
  listCategories(): Promise<CatalogFacet[]> {
    return this.catalogCache.categories(() => this.catalogRepository.listCategories());
  }

  /** Thương hiệu kèm số sản phẩm (bộ lọc trang danh sách). */
  listBrands(): Promise<CatalogFacet[]> {
    return this.catalogCache.brands(() => this.catalogRepository.listBrands());
  }

  /**
   * Tồn kho theo SKU, đọc thẳng DB (không qua cache) – dùng khi cần con số chính xác lúc này,
   * ví dụ trợ lý AI trả lời nhân viên (F06).
   */
  async stockBySku(sku: string): Promise<ProductStock> {
    const product = await this.catalogRepository.findStockBySku(sku.trim().toUpperCase());
    if (!product) throw productNotFound();
    return product;
  }

  async findOne(id: number): Promise<ProductDetail> {
    // Id không tồn tại cũng được cache (TTL ngắn) → dò id ngẫu nhiên không đập vào DB.
    const product = await this.catalogCache.product(id, () => this.catalogRepository.findById(id));
    if (!product) throw productNotFound();
    return product;
  }

  async update(id: number, dto: UpdateProductDto, actor: AuthUser): Promise<ProductDetail> {
    this.assertValidUpdate(dto, actor);
    const { price, compareAtPrice, imageUrl, stock, stockDelta, expectedStock } = dto;

    const result = await this.catalogRepository.applyPatch(id, {
      price,
      compareAtPrice,
      imageUrl,
      stock,
      stockDelta,
      expectedStock,
    });
    if (result.status === 'not_found') throw productNotFound();
    if (result.status === 'insufficient_stock') {
      throw new AppException(
        HttpStatus.CONFLICT,
        'INSUFFICIENT_STOCK',
        `Tồn kho không đủ: hiện còn ${result.available}, không thể trừ ${-(stockDelta ?? 0)}.`,
      );
    }

    if (result.status === 'stock_changed') {
      throw new AppException(
        HttpStatus.CONFLICT,
        'STOCK_CHANGED',
        `Tồn kho vừa thay đổi, hiện còn ${result.current}. Vui lòng kiểm lại rồi lưu.`,
        { current: result.current },
      );
    }
    if (result.status === 'invalid_compare_at_price') {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'INVALID_COMPARE_AT_PRICE',
        'Giá gốc phải lớn hơn giá bán.',
        { price: result.price },
      );
    }

    const changes = diff(result.before, result.after);
    if (Object.keys(changes).length > 0) {
      // applyPatch là một câu UPDATE đã commit → listener không bao giờ thấy thay đổi bị rollback.
      this.eventEmitter.emit(
        PRODUCT_UPDATED,
        new ProductUpdatedEvent(id, result.sku, changes, actor),
      );
    }
    // Đọc thẳng DB: người vừa sửa luôn thấy giá trị mới nhất, không phụ thuộc cache.
    const product = await this.catalogRepository.findById(id);
    if (!product) throw productNotFound();
    return product;
  }

  private assertValidUpdate(dto: UpdateProductDto, actor: AuthUser): void {
    const { price, compareAtPrice, imageUrl, stock, stockDelta, expectedStock } = dto;
    const editsListing =
      price !== undefined || compareAtPrice !== undefined || imageUrl !== undefined;
    if (expectedStock !== undefined && stock === undefined) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'STOCK_CONFLICT',
        'expectedStock chỉ dùng kèm stock (đặt số lượng).',
      );
    }
    if (!editsListing && stock === undefined && stockDelta === undefined) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'EMPTY_UPDATE',
        'Cần gửi ít nhất một trường: price, compareAtPrice, imageUrl, stock hoặc stockDelta.',
      );
    }
    if (stock !== undefined && stockDelta !== undefined) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'STOCK_CONFLICT',
        'Chỉ gửi một trong hai: stock (đặt số lượng) hoặc stockDelta (cộng/trừ).',
      );
    }
    if (editsListing && !PRICE_EDITOR_ROLES.includes(actor.role)) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN_FIELD',
        'Bạn chỉ được cập nhật tồn kho, không được thay đổi giá hoặc ảnh sản phẩm.',
      );
    }
  }
}

/** Chỉ giữ trường thực sự đổi giá trị; rỗng → không phát event. */
export function diff(before: ProductValues, after: ProductValues): ProductChangeSet {
  const changes: ProductChangeSet = {};
  if (before.price !== after.price) changes.price = { from: before.price, to: after.price };
  if (before.stock !== after.stock) changes.stock = { from: before.stock, to: after.stock };
  if (before.imageUrl !== after.imageUrl) {
    changes.imageUrl = { from: before.imageUrl, to: after.imageUrl };
  }
  if (before.compareAtPrice !== after.compareAtPrice) {
    changes.compareAtPrice = { from: before.compareAtPrice, to: after.compareAtPrice };
  }
  return changes;
}

function productNotFound(): AppException {
  return new AppException(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm.');
}
