import { PageMetaDto } from '../../../common/dto/page-meta.dto';

export class CatalogRefDto {
  id!: number;
  name!: string;
  slug!: string;
}

export class ProductListItemDto {
  id!: number;
  /** Mã sản phẩm, ví dụ SF-DT-0001. */
  sku!: string;
  name!: string;
  slug!: string;
  /** Giá bán (VND). */
  price!: number;
  /** Tồn kho hiện tại. */
  stock!: number;
  category!: CatalogRefDto;
  brand!: CatalogRefDto;
}

export class CatalogProductDto extends ProductListItemDto {
  /** Đường dẫn ảnh; null = chưa có ảnh. */
  imageUrl!: string | null;
  /** Giá gốc (VND), luôn lớn hơn giá bán; null = không giảm giá. */
  compareAtPrice!: number | null;
  /** Số lượng đã bán (đơn chưa huỷ); có thể trễ theo TTL cache. */
  soldCount!: number;
}

export class ProductDetailDto extends CatalogProductDto {
  description!: string | null;
  updatedAt!: Date;
}

export class ProductPageDto {
  items!: CatalogProductDto[];
  meta!: PageMetaDto;
}

/** Dòng tồn kho cho nhân viên (đọc thẳng DB). */
export class InventoryItemDto extends ProductListItemDto {
  /** Đường dẫn ảnh; null = chưa có ảnh. */
  imageUrl!: string | null;
  /** Giá gốc đã lưu (VND); có thể không lớn hơn giá bán nếu giá vừa tăng. */
  compareAtPrice!: number | null;
  updatedAt!: Date;
}

/** Số liệu toàn kho – không phụ thuộc bộ lọc. */
export class InventorySummaryDto {
  /** Tổng số SKU. */
  totalSkus!: number;
  /** Số SKU sắp hết (1 ≤ tồn < lowStockThreshold). */
  lowStock!: number;
  /** Số SKU hết hàng (tồn = 0). */
  outOfStock!: number;
  /** Tổng giá trị tồn kho theo giá bán (VND). */
  stockValue!: number;
  /** Ngưỡng "sắp hết" đang áp dụng (biến môi trường LOW_STOCK_THRESHOLD). */
  lowStockThreshold!: number;
}

export class InventoryPageDto {
  items!: InventoryItemDto[];
  meta!: PageMetaDto;
  summary!: InventorySummaryDto;
}
