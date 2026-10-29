import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Role } from '@prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { Page, toPage } from '../../common/pagination';
import type { AuthUser } from '../auth/auth.types';
import {
  CatalogRepository,
  PriceStock,
  ProductDetail,
  ProductListItem,
} from './catalog.repository';
import { ListProductsQuery } from './dto/list-products.query';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  PRODUCT_UPDATED,
  ProductChangeSet,
  ProductUpdatedEvent,
} from './events/product-updated.event';

export type ProductPage = Page<ProductListItem>;

const PRICE_EDITOR_ROLES: readonly Role[] = [Role.ADMIN];

@Injectable()
export class CatalogService {
  constructor(
    private readonly catalogRepository: CatalogRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async list(query: ListProductsQuery): Promise<ProductPage> {
    const { page, limit, sort, categoryId, brandId, minPrice, maxPrice } = query;

    if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'INVALID_PRICE_RANGE',
        'Khoảng giá không hợp lệ: giá thấp nhất phải nhỏ hơn hoặc bằng giá cao nhất.',
      );
    }

    const { items, total } = await this.catalogRepository.findPage(
      { categoryId, brandId, minPrice, maxPrice },
      sort,
      (page - 1) * limit,
      limit,
    );
    return toPage(items, total, page, limit);
  }

  async findOne(id: number): Promise<ProductDetail> {
    const product = await this.catalogRepository.findById(id);
    if (!product) throw productNotFound();
    return product;
  }

  async update(id: number, dto: UpdateProductDto, actor: AuthUser): Promise<ProductDetail> {
    this.assertValidUpdate(dto, actor);
    const { price, stock, stockDelta } = dto;

    const result = await this.catalogRepository.applyPatch(id, { price, stock, stockDelta });
    if (result.status === 'not_found') throw productNotFound();
    if (result.status === 'insufficient_stock') {
      throw new AppException(
        HttpStatus.CONFLICT,
        'INSUFFICIENT_STOCK',
        `Tồn kho không đủ: hiện còn ${result.available}, không thể trừ ${-(stockDelta ?? 0)}.`,
      );
    }

    const changes = diff(result.before, result.after);
    if (changes.price || changes.stock) {
      // applyPatch là một câu UPDATE đã commit → listener không bao giờ thấy thay đổi bị rollback.
      this.eventEmitter.emit(
        PRODUCT_UPDATED,
        new ProductUpdatedEvent(id, result.sku, changes, actor),
      );
    }
    return this.findOne(id);
  }

  private assertValidUpdate(dto: UpdateProductDto, actor: AuthUser): void {
    const { price, stock, stockDelta } = dto;
    if (price === undefined && stock === undefined && stockDelta === undefined) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'EMPTY_UPDATE',
        'Cần gửi ít nhất một trường: price, stock hoặc stockDelta.',
      );
    }
    if (stock !== undefined && stockDelta !== undefined) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'STOCK_CONFLICT',
        'Chỉ gửi một trong hai: stock (đặt số lượng) hoặc stockDelta (cộng/trừ).',
      );
    }
    if (price !== undefined && !PRICE_EDITOR_ROLES.includes(actor.role)) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN_FIELD',
        'Bạn chỉ được cập nhật tồn kho, không được thay đổi giá.',
      );
    }
  }
}

/** Chỉ giữ trường thực sự đổi giá trị; rỗng → không phát event. */
export function diff(before: PriceStock, after: PriceStock): ProductChangeSet {
  const changes: ProductChangeSet = {};
  if (before.price !== after.price) changes.price = { from: before.price, to: after.price };
  if (before.stock !== after.stock) changes.stock = { from: before.stock, to: after.stock };
  return changes;
}

function productNotFound(): AppException {
  return new AppException(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm.');
}
