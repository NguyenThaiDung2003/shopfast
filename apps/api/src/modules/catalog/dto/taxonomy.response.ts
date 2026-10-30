import { CatalogRefDto } from './product.response';

/** Danh mục hoặc thương hiệu kèm số sản phẩm (dùng cho bộ lọc). */
export class CatalogFacetDto extends CatalogRefDto {
  /** Tổng số sản phẩm thuộc mục này (không phụ thuộc bộ lọc khác). */
  productCount!: number;
}
