import { ApiProperty } from '@nestjs/swagger';
import { PendingActionStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PageQuery } from './list-tickets.query';

export class ListPendingActionsQuery extends PageQuery {
  /** Lọc theo trạng thái (mặc định: tất cả). */
  @ApiProperty({
    description: 'Lọc theo trạng thái (mặc định: tất cả).',
    enum: PendingActionStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(PendingActionStatus)
  status?: PendingActionStatus;

  /** Chỉ lấy đề xuất của ticket này. */
  @IsOptional()
  @IsUUID()
  ticketId?: string;
}
