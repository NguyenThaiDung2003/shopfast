import { ApiProperty } from '@nestjs/swagger';
import { TicketCategory, TicketStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQuery, toStatusList } from '../../orders/dto/list-orders.query';

export const MAX_TICKET_SEARCH_LENGTH = 100;

/** Từ khoá: bỏ khoảng trắng; rỗng → không lọc. */
const trimToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

/** Phân trang (page, limit) dùng chung với danh sách đơn. */
export class PageQuery extends PaginationQuery {}

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

  /** Tìm theo mã ticket, tiêu đề, mã đơn, tên hoặc email khách (tối đa 100 ký tự). */
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(MAX_TICKET_SEARCH_LENGTH)
  q?: string;
}

export class ListMyTicketsQuery extends PageQuery {
  /** Lọc theo trạng thái; nhiều trạng thái cách nhau dấu phẩy, ví dụ `OPEN,ANSWERED`. */
  @ApiProperty({
    required: false,
    enum: TicketStatus,
    enumName: 'TicketStatus',
    isArray: true,
    description: 'Lọc theo trạng thái; nhiều trạng thái cách nhau dấu phẩy, ví dụ `OPEN,ANSWERED`.',
  })
  @IsOptional()
  @Transform(toStatusList)
  @IsEnum(TicketStatus, { each: true })
  @ArrayMaxSize(Object.keys(TicketStatus).length)
  status?: TicketStatus[];

  /** Tìm theo mã ticket hoặc tiêu đề (không phân biệt hoa thường, tối đa 100 ký tự). */
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(MAX_TICKET_SEARCH_LENGTH)
  q?: string;
}
