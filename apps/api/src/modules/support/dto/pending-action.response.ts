import { ApiProperty } from '@nestjs/swagger';
import { PendingActionStatus, PendingActionType } from '@prisma/client';
import { PageMetaDto } from '../../../common/dto/page-meta.dto';

export class PendingActionDto {
  id!: string;
  @ApiProperty({
    description: 'Loại thao tác.',
    enum: PendingActionType,
    enumName: 'PendingActionType',
  })
  type!: PendingActionType;
  @ApiProperty({
    description:
      'PENDING chờ xác nhận; EXECUTING đang chạy; EXECUTED đã chạy; REJECTED bị từ chối; FAILED chạy lỗi.',
    enum: PendingActionStatus,
    enumName: 'PendingActionStatus',
  })
  status!: PendingActionStatus;
  /** Mô tả để nhân viên đọc trước khi xác nhận. */
  summary!: string;
  /** Lý do trợ lý AI đưa ra. */
  reason!: string;
  orderId!: string;
  orderCode!: string;
  ticketId!: string | null;
  ticketCode!: string | null;
  /** Nhân viên đã hỏi trợ lý AI và nhận đề xuất này. */
  proposedById!: string;
  decidedById!: string | null;
  decidedAt!: Date | null;
  decisionNote!: string | null;
  /** Mã lỗi khi thực thi thất bại (FAILED). */
  errorCode!: string | null;
  createdAt!: Date;
}

export class PendingActionPageDto {
  items!: PendingActionDto[];
  meta!: PageMetaDto;
}
