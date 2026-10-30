import { ApiProperty } from '@nestjs/swagger';
import { TicketCategory, TicketStatus } from '@prisma/client';
import { IsEnum, IsIn, IsOptional } from 'class-validator';

export class UpdateTicketDto {
  /** Đóng (CLOSED) hoặc mở lại (OPEN) ticket. */
  @ApiProperty({
    description: 'Đóng (CLOSED) hoặc mở lại (OPEN) ticket.',
    enum: [TicketStatus.OPEN, TicketStatus.CLOSED],
    required: false,
  })
  @IsOptional()
  @IsIn([TicketStatus.OPEN, TicketStatus.CLOSED])
  status?: TicketStatus;

  /** Sửa nhóm ticket bằng tay (ghi đè kết quả phân loại tự động). */
  @ApiProperty({
    description: 'Sửa nhóm ticket bằng tay (ghi đè kết quả phân loại tự động).',
    enum: TicketCategory,
    required: false,
  })
  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;
}
