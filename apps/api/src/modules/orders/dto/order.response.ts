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

/** Khách đặt đơn – chỉ hiển thị cho nhân viên. */
export class OrderCustomerDto {
  id!: string;
  fullName!: string;
  email!: string;
}

/** Thông tin nhận hàng của đơn. */
export class OrderShippingDto {
  recipientName!: string;
  phone!: string;
  address!: string;
  note!: string | null;
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
  /** Thông tin nhận hàng; null ở đơn tạo trước khi có bước thanh toán. */
  shipping!: OrderShippingDto | null;
  items!: OrderItemDto[];
  /** Lịch sử chuyển trạng thái, cũ nhất trước. */
  statusHistory!: OrderStatusChangeDto[];
  /** Khách đặt đơn – chỉ hiển thị cho nhân viên. */
  customer?: OrderCustomerDto;
  @ApiProperty({
    description:
      'Các trạng thái có thể chuyển tới từ trạng thái hiện tại (ADR-0006) – chỉ hiển thị cho nhân viên.',
    enum: OrderStatus,
    enumName: 'OrderStatus',
    isArray: true,
    required: false,
  })
  nextStatuses?: OrderStatus[];
}

export class OrderPageDto {
  items!: OrderDto[];
  meta!: PageMetaDto;
}

/** Số đơn theo từng trạng thái (cùng từ khoá `q`, không áp bộ lọc `status`). */
export class OrderStatusCountsDto {
  /** Chờ thanh toán. */
  PENDING_PAYMENT!: number;
  /** Đã thanh toán. */
  PAID!: number;
  /** Đang xử lý. */
  PROCESSING!: number;
  /** Đang giao. */
  SHIPPING!: number;
  /** Đã giao. */
  DELIVERED!: number;
  /** Đã huỷ. */
  CANCELLED!: number;
}

export class MyOrderPageDto extends OrderPageDto {
  statusCounts!: OrderStatusCountsDto;
}

/** Danh sách đơn cho nhân viên kèm số đơn theo trạng thái. */
export class StaffOrderPageDto extends MyOrderPageDto {}
