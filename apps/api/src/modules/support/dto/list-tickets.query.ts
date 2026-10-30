import { ApiProperty } from '@nestjs/swagger';
import { TicketCategory, TicketStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { ListOrdersQuery } from '../../orders/dto/list-orders.query';

/** Phân trang (page, limit) dùng chung với danh sách đơn. */
export class PageQuery extends ListOrdersQuery {}

export class ListTicketsQuery extends PageQuery {
  /** Lọc theo trạng thái. */
  @ApiProperty({ description: 'Lọc theo trạng thái.', enum: TicketStatus, required: false })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  /** Lọc theo nhóm. */
  @ApiProperty({ description: 'Lọc theo nhóm.', enum: TicketCategory, required: false })
  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;
}
