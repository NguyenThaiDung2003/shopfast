import type { OrderStatus } from '@prisma/client';
import type { AuthUser } from '../../auth/auth.types';

export const ORDER_STATUS_CHANGED = 'order.status_changed';

/**
 * Phát sau khi transaction đổi trạng thái đã commit (ADR-0006).
 * Listener dự kiến: đẩy realtime tới khách đang theo dõi đơn (F02), gửi email/thông báo,
 * huỷ nhắc thanh toán khi đơn đã PAID/CANCELLED (F05).
 */
export class OrderStatusChangedEvent {
  constructor(
    readonly orderId: string,
    readonly code: string,
    /** Chủ đơn – dùng để chọn kênh realtime. */
    readonly userId: string,
    readonly from: OrderStatus,
    readonly to: OrderStatus,
    readonly changedBy: AuthUser,
    readonly note: string | null,
    readonly occurredAt: Date = new Date(),
  ) {}
}
