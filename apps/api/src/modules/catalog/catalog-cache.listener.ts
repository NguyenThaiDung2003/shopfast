import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CatalogCacheService } from './catalog-cache.service';
import { PRODUCT_UPDATED, ProductUpdatedEvent } from './events/product-updated.event';

/**
 * Giá/tồn kho đổi (PATCH, đặt đơn, huỷ đơn) → làm mất hiệu lực cache.
 * Ngoại lệ của ADR-0004: KHÔNG dùng `async: true`. Handler chạy đồng bộ trong `emit()`, nên lệnh
 * Redis rời process trước khi response được gửi → GET ngay sau đó không thấy giá cũ (ADR-0007).
 * CatalogCacheService tự bắt lỗi nên handler không bao giờ ném.
 */
@Injectable()
export class CatalogCacheListener {
  constructor(private readonly catalogCache: CatalogCacheService) {}

  @OnEvent(PRODUCT_UPDATED)
  handleProductUpdated(event: ProductUpdatedEvent): Promise<void> {
    return this.catalogCache.invalidateProduct(event.productId);
  }
}
