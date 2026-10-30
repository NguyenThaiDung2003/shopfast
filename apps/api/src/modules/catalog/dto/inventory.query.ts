import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MAX_PAGE, MAX_PAGE_SIZE } from './list-products.query';

export const MAX_INVENTORY_SEARCH_LENGTH = 100;

/** Mức tồn so với ngưỡng `LOW_STOCK_THRESHOLD`. */
export enum StockLevel {
  /** Hết hàng (tồn = 0). */
  OUT = 'out',
  /** Sắp hết (1 ≤ tồn < ngưỡng). */
  LOW = 'low',
  /** Đủ hàng (tồn ≥ ngưỡng). */
  OK = 'ok',
}

export enum InventorySort {
  STOCK_ASC = 'stock_asc',
  STOCK_DESC = 'stock_desc',
  SKU = 'sku',
  UPDATED = 'updated',
}

export class InventoryQuery {
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
  limit: number = 25;

  /** Tìm theo SKU hoặc tên sản phẩm (không phân biệt hoa thường, tối đa 100 ký tự). */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(MAX_INVENTORY_SEARCH_LENGTH)
  q?: string;

  /** Lọc theo danh mục. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  @ApiProperty({
    description: 'Lọc theo mức tồn: out = hết hàng, low = sắp hết (< ngưỡng), ok = đủ hàng.',
    enum: StockLevel,
    enumName: 'StockLevel',
    required: false,
  })
  @IsOptional()
  @IsEnum(StockLevel)
  stockLevel?: StockLevel;

  @ApiProperty({
    description: 'Sắp xếp; mặc định tồn kho tăng dần (hàng sắp hết lên đầu).',
    enum: InventorySort,
    enumName: 'InventorySort',
    required: false,
  })
  @IsOptional()
  @IsEnum(InventorySort)
  sort: InventorySort = InventorySort.STOCK_ASC;
}
