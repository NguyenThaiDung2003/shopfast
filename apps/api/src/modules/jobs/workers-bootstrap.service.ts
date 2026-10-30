import { InjectQueue } from '@nestjs/bullmq';
import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { EnvironmentVariables } from '../../config/env.validation';
import { ShutdownService } from '../health/shutdown.service';
import {
  EmailProcessor,
  InventorySyncProcessor,
  InvoiceProcessor,
  TicketClassifyProcessor,
} from './processors';
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
 *
 * Khi tắt (ADR-0012): chờ hết drain rồi đóng worker – `close()` không nhận job mới và CHỜ job
 * đang chạy xong, trong lúc DB/Redis vẫn mở. Worker mới phải thêm vào `processors`.
 */
@Injectable()
export class WorkersBootstrapService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(WorkersBootstrapService.name);
  private readonly enabled: boolean;
  private readonly timeZone: string;

  constructor(
    private readonly emailProcessor: EmailProcessor,
    private readonly invoiceProcessor: InvoiceProcessor,
    private readonly inventorySyncProcessor: InventorySyncProcessor,
    private readonly ticketClassifyProcessor: TicketClassifyProcessor,
    @InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue,
    private readonly shutdown: ShutdownService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.enabled = config.get('QUEUE_WORKERS_ENABLED', { infer: true });
    this.timeZone = config.get('REPORT_TIMEZONE', { infer: true });
  }

  private get processors() {
    return [
      this.emailProcessor,
      this.invoiceProcessor,
      this.inventorySyncProcessor,
      this.ticketClassifyProcessor,
    ];
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) return;
    for (const processor of this.processors) {
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

  async beforeApplicationShutdown(): Promise<void> {
    if (!this.enabled) return;
    await this.shutdown.drained();
    const started = Date.now();
    const active = this.processors.filter((p) => p.worker.isRunning()).length;
    this.logger.log(`Shutdown: closing ${active} workers, waiting for active jobs`);
    // Không ép (force=false): job đang chạy được làm xong; ShutdownService có giới hạn cứng.
    await Promise.all(
      this.processors.map((p) =>
        p.worker
          .close()
          .catch((error: Error) =>
            this.logger.error(`Worker ${p.worker.name} close failed: ${error.message}`),
          ),
      ),
    );
    this.logger.log(`Shutdown: workers closed in ${Date.now() - started}ms`);
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
