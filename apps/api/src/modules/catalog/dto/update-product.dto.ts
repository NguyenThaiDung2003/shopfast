import { IsInt, IsOptional, Max, Min, NotEquals } from 'class-validator';

const MAX_PRICE = 2_000_000_000; // giới hạn INTEGER, đơn vị đồng
const MAX_STOCK = 1_000_000;

/**
 * Cập nhật giá/tồn kho. Chỉ ADMIN được đổi giá.
 * Tồn kho: `stock` đặt giá trị tuyệt đối (kiểm kê), `stockDelta` cộng/trừ (nhập/xuất kho);
 * không gửi cả hai cùng lúc.
 */
export class UpdateProductDto {
  /** Giá mới (VND). Chỉ ADMIN. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  price?: number;

  /** Đặt tồn kho tuyệt đối (kiểm kê). Không gửi kèm stockDelta. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_STOCK)
  stock?: number;

  /** Cộng (+ nhập kho) hoặc trừ (− xuất kho) tồn kho; khác 0. */
  @IsOptional()
  @IsInt()
  @NotEquals(0)
  @Min(-MAX_STOCK)
  @Max(MAX_STOCK)
  stockDelta?: number;
}
