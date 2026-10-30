import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ORDER_STATUS_CHANGED,
  OrderStatusChangedEvent,
} from '../orders/events/order-status-changed.event';
import { toOrderUpdatedPayload } from './order-tracking.service';
import { OrdersGateway } from './orders.gateway';

/** `order.status_changed` (sau commit) → `order:updated` vào room của đơn (F02, ADR-0010). */
@Injectable()
export class OrderRealtimeListener {
  private readonly logger = new Logger(OrderRealtimeListener.name);

  constructor(private readonly gateway: OrdersGateway) {}

  @OnEvent(ORDER_STATUS_CHANGED, { async: true, suppressErrors: true })
  handleStatusChanged(event: OrderStatusChangedEvent): void {
    try {
      this.gateway.emitOrderUpdated(toOrderUpdatedPayload(event));
    } catch (error) {
      // Mất một lần đẩy realtime không làm hỏng request gốc; client bù khi subscribe lại.
      this.logger.error(
        `Realtime push for order ${event.orderId} failed: ${(error as Error).message}`,
      );
    }
  }
}
