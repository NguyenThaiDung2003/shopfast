import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';

const MAX_PRICE = 2_000_000_000; // giới hạn INTEGER, đơn vị đồng
const MAX_STOCK = 1_000_000;
const MAX_IMAGE_URL_LENGTH = 500;
// Đường dẫn cùng site hoặc https. Chặn `//host` và `/\host`: trình duyệt coi là URL ngoài site.
const IMAGE_URL_PATTERN = /^(?:\/(?![/\\])|https:\/\/)[^\s\\]+$/;

/**
 * Cập nhật sản phẩm. Chỉ ADMIN được đổi giá, giá gốc và ảnh.
 * Tồn kho: `stock` đặt giá trị tuyệt đối (kiểm kê), `stockDelta` cộng/trừ (nhập/xuất kho);
 * không gửi cả hai cùng lúc. Kiểm kê nên gửi kèm `expectedStock` để không đè số vừa bị đơn trừ.
 * `compareAtPrice` và `imageUrl`: gửi `null` để xoá, không gửi thì giữ nguyên.
 */
export class UpdateProductDto {
  /** Giá mới (VND). Chỉ ADMIN. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  price?: number;

  /** Giá gốc (VND), phải lớn hơn giá bán; null = bỏ giảm giá. Chỉ ADMIN. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PRICE)
  compareAtPrice?: number | null;

  /** Đường dẫn `/...` hoặc URL `https://...` của ảnh; null = xoá ảnh. Chỉ ADMIN. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_IMAGE_URL_LENGTH)
  @Matches(IMAGE_URL_PATTERN, { message: 'Đường dẫn ảnh phải bắt đầu bằng / hoặc https://.' })
  imageUrl?: string | null;

  /** Đặt tồn kho tuyệt đối (kiểm kê). Không gửi kèm stockDelta. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_STOCK)
  stock?: number;

  /** Số tồn lúc bắt đầu kiểm kê; khác tồn hiện tại → 409 STOCK_CHANGED. Chỉ đi kèm `stock`. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_STOCK)
  expectedStock?: number;

  /** Cộng (+ nhập kho) hoặc trừ (− xuất kho) tồn kho; khác 0. */
  @IsOptional()
  @IsInt()
  @NotEquals(0)
  @Min(-MAX_STOCK)
  @Max(MAX_STOCK)
  stockDelta?: number;
}
