import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { EnvironmentVariables } from '../../config/env.validation';
import { EmailProcessor, InventorySyncProcessor, InvoiceProcessor } from './processors';
import {
  DAILY_REPORT_CRON,
  DAILY_REPORT_SCHEDULER_ID,
  DailyReportJobData,
  EMAIL_QUEUE,
  EmailJob,
} from './queues';

/**
 * Khởi chạy worker và lịch báo cáo khi QUEUE_WORKERS_ENABLED. Instance tắt cờ này vẫn đẩy job
 * được, chỉ không xử lý – tách API và worker thành hai nhóm process khi cần mở rộng.
 */
@Injectable()
export class WorkersBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkersBootstrapService.name);
  private readonly enabled: boolean;
  private readonly timeZone: string;

  constructor(
    private readonly emailProcessor: EmailProcessor,
    private readonly invoiceProcessor: InvoiceProcessor,
    private readonly inventorySyncProcessor: InventorySyncProcessor,
    @InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.enabled = config.get('QUEUE_WORKERS_ENABLED', { infer: true });
    this.timeZone = config.get('REPORT_TIMEZONE', { infer: true });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) return;
    for (const processor of [
      this.emailProcessor,
      this.invoiceProcessor,
      this.inventorySyncProcessor,
    ]) {
      // run() chỉ resolve khi worker đóng (lúc tắt app).
      processor.worker
        .run()
        .catch((error: Error) =>
          this.logger.error(`Worker ${processor.worker.name} stopped: ${error.message}`),
        );
    }
    // Không await: Redis đang sập thì lệnh chờ kết nối lại, không được chặn app khởi động.
    void this.scheduleDailyReport();
  }

  /** Lặp 0h hằng ngày. upsert theo id cố định: nhiều instance khởi động cũng chỉ một lịch. */
  private async scheduleDailyReport(): Promise<void> {
    try {
      await this.emailQueue.upsertJobScheduler(
        DAILY_REPORT_SCHEDULER_ID,
        { pattern: DAILY_REPORT_CRON, tz: this.timeZone },
        { name: EmailJob.DAILY_REVENUE_REPORT, data: {} satisfies DailyReportJobData },
      );
    } catch (error) {
      this.logger.error(`Could not schedule daily revenue report: ${(error as Error).message}`);
    }
  }
}
