import { ApiProperty } from '@nestjs/swagger';
import { CategorySource, Role, TicketCategory, TicketStatus } from '@prisma/client';
import { PageMetaDto } from '../../../common/dto/page-meta.dto';

export class TicketAuthorDto {
  @ApiProperty({ description: 'Vai trò người viết.', enum: Role, enumName: 'Role' })
  role!: Role;
  fullName!: string;
}

export class TicketMessageDto {
  id!: number;
  body!: string;
  createdAt!: Date;
  author!: TicketAuthorDto;
}

export class TicketCustomerDto {
  id!: string;
  fullName!: string;
  email!: string;
}

export class TicketDto {
  id!: string;
  /** Mã ticket hiển thị, ví dụ TK-000001. */
  code!: string;
  subject!: string;
  @ApiProperty({ description: 'Trạng thái ticket.', enum: TicketStatus, enumName: 'TicketStatus' })
  status!: TicketStatus;
  @ApiProperty({
    description: 'Nhóm ticket; null = đang chờ phân loại tự động.',
    enum: TicketCategory,
    enumName: 'TicketCategory',
    nullable: true,
  })
  category!: TicketCategory | null;
  @ApiProperty({
    description: 'Nguồn gán nhóm: LLM, FALLBACK (LLM lỗi/tắt → KHAC) hoặc STAFF.',
    enum: CategorySource,
    enumName: 'CategorySource',
    nullable: true,
  })
  categorySource!: CategorySource | null;
  /** Id đơn liên quan. */
  orderId!: string | null;
  /** Mã đơn liên quan. */
  orderCode!: string | null;
  /** Khách tạo ticket – chỉ hiển thị cho nhân viên. */
  customer?: TicketCustomerDto;
  lastMessageAt!: Date;
  createdAt!: Date;
}

export class TicketDetailDto extends TicketDto {
  /** Tin nhắn, cũ nhất trước. */
  messages!: TicketMessageDto[];
}

export class TicketPageDto {
  items!: TicketDto[];
  meta!: PageMetaDto;
}
