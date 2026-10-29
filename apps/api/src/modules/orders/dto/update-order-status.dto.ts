import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOrderStatusDto {
  /** Trạng thái mới; phải là bước hợp lệ từ trạng thái hiện tại (ADR-0006). */
  @ApiProperty({
    description: 'Trạng thái mới; phải là bước hợp lệ từ trạng thái hiện tại (ADR-0006).',
    // Không đặt enumName: enum được khai báo inline nên giữ được description
    // (OpenAPI 3.0 bỏ qua thuộc tính cạnh $ref).
    enum: OrderStatus,
    example: OrderStatus.PAID,
  })
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  /** Ghi chú, ví dụ lý do huỷ hoặc mã vận đơn. */
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(500)
  note?: string;
}
