import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus, Role } from '@prisma/client';
import { PageMetaDto } from '../../../common/dto/page-meta.dto';

export class OrderItemDto {
  productId!: number;
  sku!: string;
  name!: string;
  quantity!: number;
  /** Đơn giá tại thời điểm đặt (VND). */
  unitPrice!: number;
  /** unitPrice × quantity (VND). */
  lineTotal!: number;
}

export class ChangedByDto {
  /** Chỉ hiển thị cho nhân viên. */
  id?: string;
  /** Chỉ hiển thị cho nhân viên. */
  fullName?: string;
  @ApiProperty({ description: 'Vai trò của người đổi trạng thái.', enum: Role, enumName: 'Role' })
  role!: Role;
}

export class OrderStatusChangeDto {
  /** null = lúc tạo đơn. */
  @ApiProperty({
    description: 'null = lúc tạo đơn.',
    enum: OrderStatus,
    enumName: 'OrderStatus',
    nullable: true,
  })
  from!: OrderStatus | null;
  @ApiProperty({
    description: 'Trạng thái sau khi chuyển.',
    enum: OrderStatus,
    enumName: 'OrderStatus',
  })
  to!: OrderStatus;
  note!: string | null;
  changedAt!: Date;
  changedBy!: ChangedByDto;
}

export class OrderDto {
  id!: string;
  /** Mã đơn hiển thị cho khách, ví dụ SF-000051. */
  code!: string;
  @ApiProperty({
    description: 'Trạng thái hiện tại (state machine: ADR-0006).',
    enum: OrderStatus,
    enumName: 'OrderStatus',
  })
  status!: OrderStatus;
  /** Tổng tiền (VND). */
  totalAmount!: number;
  paidAt!: Date | null;
  createdAt!: Date;
  items!: OrderItemDto[];
  /** Lịch sử chuyển trạng thái, cũ nhất trước. */
  statusHistory!: OrderStatusChangeDto[];
}

export class OrderPageDto {
  items!: OrderDto[];
  meta!: PageMetaDto;
}
