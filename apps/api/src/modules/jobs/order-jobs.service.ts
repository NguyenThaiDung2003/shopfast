import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@prisma/client';
import { JobsOptions, Queue } from 'bullmq';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { OrderCreatedEvent } from '../orders/events/order-created.event';
import type { OrderStatusChangedEvent } from '../orders/events/order-status-changed.event';
import {
  EMAIL_QUEUE,
  EmailJob,
  INVENTORY_SYNC_QUEUE,
  InventorySyncJob,
  INVOICE_JOB,
  INVOICE_QUEUE,
  OrderJobData,
  orderJobId,
} from './queues';

/** Redis sập: lệnh nằm trong offline queue của ioredis; không để listener chờ quá lâu. */
const ENQUEUE_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Ánh xạ domain event của đơn hàng → job F05 (ADR-0009). Chạy trong listener `async: true`
 * nên request gốc đã trả về; lỗi chỉ log, không ném.
 */
@Injectable()
export class OrderJobsService {
  private readonly logger = new Logger(OrderJobsService.name);
  private readonly reminderDelayMs: number;

  constructor(
    @InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue,
    @InjectQueue(INVOICE_QUEUE) private readonly invoiceQueue: Queue,
    @InjectQueue(INVENTORY_SYNC_QUEUE) private readonly inventoryQueue: Queue,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.reminderDelayMs = config.get('PAYMENT_REMINDER_DELAY_MS', { infer: true });
  }

  async onOrderCreated(event: OrderCreatedEvent): Promise<void> {
    const data: OrderJobData = { orderId: event.orderId, code: event.code };
    await Promise.all([
      this.enqueue(this.emailQueue, EmailJob.ORDER_CONFIRMATION, data),
      this.enqueue(this.inventoryQueue, InventorySyncJob.RESERVE, data),
      // Worker kiểm lại trạng thái lúc chạy, nên không cần gỡ job này thật chính xác.
      this.enqueue(this.emailQueue, EmailJob.PAYMENT_REMINDER, data, {
        delay: this.reminderDelayMs,
      }),
    ]);
  }

  async onStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    const data: OrderJobData = { orderId: event.orderId, code: event.code };
    if (event.to === OrderStatus.PAID) {
      await Promise.all([
        this.enqueue(this.invoiceQueue, INVOICE_JOB, data),
        this.cancelReminder(event.orderId),
      ]);
    } else if (event.to === OrderStatus.CANCELLED) {
      await Promise.all([
        this.enqueue(this.inventoryQueue, InventorySyncJob.RELEASE, data),
        this.cancelReminder(event.orderId),
      ]);
    }
  }

  private async enqueue(
    queue: Queue,
    jobName: string,
    data: OrderJobData,
    opts: JobsOptions = {},
  ): Promise<void> {
    const jobId = orderJobId(jobName, data.orderId);
    try {
      await withTimeout(queue.add(jobName, data, { ...opts, jobId }), ENQUEUE_TIMEOUT_MS);
    } catch (error) {
      this.logger.error(
        `Enqueue ${queue.name}/${jobId} failed (order ${data.code}): ${(error as Error).message}`,
      );
    }
  }

  /** Đơn đã thanh toán/huỷ: gỡ job nhắc đang hẹn giờ (đang chạy thì kệ, worker tự bỏ qua). */
  private async cancelReminder(orderId: string): Promise<void> {
    const jobId = orderJobId(EmailJob.PAYMENT_REMINDER, orderId);
    try {
      await withTimeout(this.emailQueue.remove(jobId), ENQUEUE_TIMEOUT_MS);
    } catch (error) {
      this.logger.warn(`Remove ${EMAIL_QUEUE}/${jobId} failed: ${(error as Error).message}`);
    }
  }
}
