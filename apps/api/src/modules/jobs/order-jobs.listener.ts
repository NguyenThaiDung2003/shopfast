import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_CREATED, OrderCreatedEvent } from '../orders/events/order-created.event';
import {
  ORDER_STATUS_CHANGED,
  OrderStatusChangedEvent,
} from '../orders/events/order-status-changed.event';
import { OrderJobsService } from './order-jobs.service';

/** Đơn tạo/đổi trạng thái → đẩy job F05. Chạy bất đồng bộ: API không chờ (ADR-0004, ADR-0009). */
@Injectable()
export class OrderJobsListener {
  constructor(private readonly orderJobs: OrderJobsService) {}

  @OnEvent(ORDER_CREATED, { async: true, suppressErrors: true })
  handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
    return this.orderJobs.onOrderCreated(event);
  }

  @OnEvent(ORDER_STATUS_CHANGED, { async: true, suppressErrors: true })
  handleStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    return this.orderJobs.onStatusChanged(event);
  }
}
