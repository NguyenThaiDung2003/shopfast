import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { DeadLetterService } from './dead-letter.service';
import { EmailJobResult, EmailJobsService } from './email-jobs.service';
import { InventorySyncService } from './inventory-sync.service';
import { InvoiceJobResult, InvoiceService } from './invoice.service';
import {
  DailyReportJobData,
  EMAIL_QUEUE,
  EmailJob,
  INVENTORY_SYNC_QUEUE,
  InventorySyncJob,
  INVOICE_QUEUE,
  OrderJobData,
} from './queues';

// Processor chỉ định tuyến job → service (logic + unit test nằm ở service).
// autorun: false – WorkersBootstrap chỉ chạy worker khi QUEUE_WORKERS_ENABLED (ADR-0009).

const WORKER_ERROR_LOG_INTERVAL_MS = 10_000;

/** Phần chung của mọi processor: chuyển job hết lượt sang dead-letter, log lỗi kết nối. */
abstract class ReportingWorkerHost extends WorkerHost {
  private readonly logger = new Logger(this.constructor.name);
  private lastErrorLogAt = 0;

  protected constructor(
    private readonly queueName: string,
    private readonly deadLetters: DeadLetterService,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): Promise<boolean> {
    return this.deadLetters.handleFailed(this.queueName, job, error);
  }

  /**
   * Bắt buộc có: Worker phát `error` khi mất kết nối Redis; EventEmitter không có listener cho
   * `error` sẽ ném ra ngoài và làm sập process. Worker tự kết nối lại, ở đây chỉ log.
   */
  @OnWorkerEvent('error')
  onError(error: Error): void {
    const now = Date.now();
    if (now - this.lastErrorLogAt < WORKER_ERROR_LOG_INTERVAL_MS) return;
    this.lastErrorLogAt = now;
    this.logger.warn(`Worker ${this.queueName} error: ${error.message}`);
  }
}

@Processor(EMAIL_QUEUE, { autorun: false, concurrency: 5 })
export class EmailProcessor extends ReportingWorkerHost {
  constructor(
    private readonly emailJobs: EmailJobsService,
    deadLetters: DeadLetterService,
  ) {
    super(EMAIL_QUEUE, deadLetters);
  }

  process(job: Job): Promise<EmailJobResult> {
    switch (job.name) {
      case EmailJob.ORDER_CONFIRMATION:
        return this.emailJobs.sendOrderConfirmation((job.data as OrderJobData).orderId);
      case EmailJob.PAYMENT_REMINDER:
        return this.emailJobs.sendPaymentReminder((job.data as OrderJobData).orderId);
      case EmailJob.DAILY_REVENUE_REPORT:
        return this.emailJobs.sendDailyRevenueReport((job.data as DailyReportJobData).date);
      default:
        throw new UnrecoverableError(`Unknown email job "${job.name}"`);
    }
  }
}

@Processor(INVOICE_QUEUE, { autorun: false, concurrency: 2 })
export class InvoiceProcessor extends ReportingWorkerHost {
  constructor(
    private readonly invoices: InvoiceService,
    deadLetters: DeadLetterService,
  ) {
    super(INVOICE_QUEUE, deadLetters);
  }

  process(job: Job<OrderJobData>): Promise<InvoiceJobResult> {
    return this.invoices.generate(job.data.orderId);
  }
}

@Processor(INVENTORY_SYNC_QUEUE, { autorun: false, concurrency: 5 })
export class InventorySyncProcessor extends ReportingWorkerHost {
  constructor(
    private readonly inventorySync: InventorySyncService,
    deadLetters: DeadLetterService,
  ) {
    super(INVENTORY_SYNC_QUEUE, deadLetters);
  }

  process(job: Job<OrderJobData>) {
    if (job.name !== InventorySyncJob.RESERVE && job.name !== InventorySyncJob.RELEASE) {
      throw new UnrecoverableError(`Unknown inventory-sync job "${job.name}"`);
    }
    return this.inventorySync.sync(job.name, job.data.orderId, job.id ?? job.name);
  }
}
