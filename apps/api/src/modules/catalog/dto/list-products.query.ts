import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ProductSort } from '../catalog.query';

export const MAX_PAGE_SIZE = 100;
// Chặn OFFSET quá sâu (OFFSET lớn buộc DB quét bỏ rất nhiều dòng).
export const MAX_PAGE = 1000;

export class ListProductsQuery {
  /** Trang (bắt đầu từ 1, tối đa 1000). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page: number = 1;

  /** Số sản phẩm mỗi trang (1–100). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = 20;

  /** Lọc theo danh mục. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  /** Lọc theo thương hiệu. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  brandId?: number;

  /** Giá tối thiểu (VND, bao gồm). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  /** Giá tối đa (VND, bao gồm). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  /** Kiểu sắp xếp; luôn kèm id làm khoá phụ. */
  @IsOptional()
  @IsEnum(ProductSort)
  sort: ProductSort = ProductSort.NEWEST;
}
