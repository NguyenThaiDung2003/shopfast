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

export class ProductDetailDto extends ProductListItemDto {
  description!: string | null;
  updatedAt!: Date;
}

export class ProductPageDto {
  items!: ProductListItemDto[];
  meta!: PageMetaDto;
}
