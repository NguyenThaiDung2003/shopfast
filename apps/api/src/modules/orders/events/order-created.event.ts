export const ORDER_CREATED = 'order.created';

export interface OrderCreatedItem {
  productId: number;
  quantity: number;
  unitPrice: number;
}

/**
 * Phát sau khi transaction tạo đơn đã commit. Listener dự kiến: gửi email xác nhận,
 * xuất hoá đơn, đồng bộ tồn kho với đối tác, hẹn nhắc thanh toán 30 phút (F05).
 */
export class OrderCreatedEvent {
  constructor(
    readonly orderId: string,
    readonly code: string,
    readonly userId: string,
    readonly totalAmount: number,
    readonly items: OrderCreatedItem[],
    readonly occurredAt: Date = new Date(),
  ) {}
}
