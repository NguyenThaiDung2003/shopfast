import { ApiProperty } from '@nestjs/swagger';

/** Định dạng lỗi chuẩn do HttpExceptionFilter trả về. */
export class ErrorResponseDto {
  /** Mã HTTP. */
  @ApiProperty({ description: 'Mã HTTP.', example: 409 })
  statusCode!: number;

  /** Mã lỗi ổn định cho client xử lý. */
  @ApiProperty({ description: 'Mã lỗi ổn định cho client xử lý.', example: 'OUT_OF_STOCK' })
  code!: string;

  /** Thông điệp tiếng Việt hiển thị cho người dùng. */
  @ApiProperty({
    description: 'Thông điệp tiếng Việt hiển thị cho người dùng.',
    example: 'Không đủ hàng: "Chuột không dây" (SF-PK-0001) còn 2, bạn đặt 3.',
  })
  message!: string;

  @ApiProperty({ example: '/api/orders' })
  path!: string;

  @ApiProperty({ example: '2026-10-29T10:00:00.000Z' })
  timestamp!: string;

  /** Dữ liệu có cấu trúc kèm theo (nếu có), ví dụ danh sách sản phẩm thiếu. */
  @ApiProperty({
    description: 'Dữ liệu có cấu trúc kèm theo (nếu có), ví dụ danh sách sản phẩm thiếu.',
    required: false,
  })
  details?: unknown;
}
