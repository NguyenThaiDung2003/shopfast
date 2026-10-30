import { Transform, Type } from 'class-transformer';
import { IsOptional, IsString, Length, Matches, MaxLength, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** SĐT Việt Nam: 0xxxxxxxxx hoặc +84xxxxxxxxx. */
export const VN_PHONE_PATTERN = /^(0|\+84)\d{9}$/;

export class ShippingInfoDto {
  /** Họ tên người nhận (2–100 ký tự). */
  @IsString()
  @Transform(trim)
  @Length(2, 100)
  recipientName!: string;

  /** Số điện thoại người nhận, ví dụ 0912345678. */
  @IsString()
  @Transform(trim)
  @Matches(VN_PHONE_PATTERN, { message: 'Số điện thoại không hợp lệ.' })
  phone!: string;

  /** Địa chỉ nhận hàng đầy đủ (5–300 ký tự). */
  @IsString()
  @Transform(trim)
  @Length(5, 300)
  address!: string;

  /** Ghi chú giao hàng (tối đa 500 ký tự). */
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  note?: string;
}

export class CreateOrderDto {
  /** Thông tin nhận hàng. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ShippingInfoDto)
  shipping?: ShippingInfoDto;
}
