import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const MAX_ORDER_SEARCH_LENGTH = 100;

/** `status=PAID,PROCESSING` hoặc `status=PAID&status=PROCESSING` → mảng; rỗng → không lọc. */
export function toStatusList({ value }: { value: unknown }): unknown {
  const raw = Array.isArray(value) ? value : [value];
  const list = raw
    .flatMap((v) => (typeof v === 'string' ? v.split(',') : [v]))
    .map((v) => (typeof v === 'string' ? v.trim() : v))
    .filter((v) => v !== '');
  return list.length > 0 ? list : undefined;
}

/** Phân trang chung (lịch sử đơn, ticket của khách…). */
export class PaginationQuery {
  /** Trang (bắt đầu từ 1). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page: number = 1;

  /** Số đơn mỗi trang (1–50). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
}

export class ListOrdersQuery extends PaginationQuery {
  /** Lọc theo trạng thái; nhiều trạng thái cách nhau dấu phẩy, ví dụ `PAID,PROCESSING`. */
  @ApiProperty({
    required: false,
    enum: OrderStatus,
    enumName: 'OrderStatus',
    isArray: true,
    description:
      'Lọc theo trạng thái; nhiều trạng thái cách nhau dấu phẩy, ví dụ `PAID,PROCESSING`.',
  })
  @IsOptional()
  @Transform(toStatusList)
  @IsEnum(OrderStatus, { each: true })
  @ArrayMaxSize(Object.keys(OrderStatus).length)
  status?: OrderStatus[];

  /** Tìm theo mã đơn hoặc tên sản phẩm trong đơn (không phân biệt hoa thường, tối đa 100 ký tự). */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(MAX_ORDER_SEARCH_LENGTH)
  q?: string;
}
