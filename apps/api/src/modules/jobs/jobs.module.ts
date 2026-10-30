import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import { HealthModule } from '../health/health.module';
import { SupportModule } from '../support/support.module';
import { DeadLetterService } from './dead-letter.service';
import { EmailDeliveriesRepository } from './email-deliveries.repository';
import { EmailJobsService } from './email-jobs.service';
import { InventorySyncService } from './inventory-sync.service';
import { InvoiceService } from './invoice.service';
import { JobsAdminController } from './jobs-admin.controller';
import { JobsRepository } from './jobs.repository';
import { MAIL_SENDER, SmtpMailSender } from './mail-sender';
import { OrderJobsListener } from './order-jobs.listener';
import { OrderJobsService } from './order-jobs.service';
import { FakePartnerInventoryClient, PARTNER_INVENTORY_CLIENT } from './partner-inventory.client';
import {
  EmailProcessor,
  InventorySyncProcessor,
  InvoiceProcessor,
  TicketClassifyProcessor,
} from './processors';
import { queueConnection } from './queue-connection';
import { QueueStatsService } from './queue-stats.service';
import { TicketJobsListener } from './ticket-jobs.listener';
import { DEAD_LETTER_JOB_OPTIONS, DEAD_LETTER_QUEUE, jobOptionsFor, WORKER_QUEUES } from './queues';
import { WorkersBootstrapService } from './workers-bootstrap.service';

/** Background jobs trên BullMQ (F05, ADR-0009). */
@Module({
  imports: [
    // Worker ticket-classify gọi TicketClassifierService.
    SupportModule,
    // Worker chờ ShutdownService.drained() trước khi đóng (ADR-0012).
    HealthModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        connection: queueConnection(config.get('REDIS_URL', { infer: true })),
        prefix: config.get('QUEUE_PREFIX', { infer: true }),
      }),
    }),
    ...WORKER_QUEUES.map((name) =>
      BullModule.registerQueueAsync({
        name,
        inject: [ConfigService],
        useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
          defaultJobOptions: jobOptionsFor(
            name,
            config.get('QUEUE_BACKOFF_BASE_MS', { infer: true }),
          ),
        }),
      }),
    ),
    BullModule.registerQueue({
      name: DEAD_LETTER_QUEUE,
      defaultJobOptions: DEAD_LETTER_JOB_OPTIONS,
    }),
  ],
  controllers: [JobsAdminController],
  providers: [
    OrderJobsListener,
    TicketJobsListener,
    OrderJobsService,
    EmailJobsService,
    InvoiceService,
    InventorySyncService,
    DeadLetterService,
    QueueStatsService,
    JobsRepository,
    EmailDeliveriesRepository,
    EmailProcessor,
    InvoiceProcessor,
    InventorySyncProcessor,
    TicketClassifyProcessor,
    WorkersBootstrapService,
    { provide: MAIL_SENDER, useClass: SmtpMailSender },
    { provide: PARTNER_INVENTORY_CLIENT, useClass: FakePartnerInventoryClient },
  ],
})
export class JobsModule {}
