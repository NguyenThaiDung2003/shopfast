import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { TICKET_CREATED, TicketCreatedEvent } from '../support/events/ticket-created.event';
import { ENQUEUE_TIMEOUT_MS, withTimeout } from './order-jobs.service';
import { TICKET_CLASSIFY_JOB, TICKET_CLASSIFY_QUEUE, TicketJobData, ticketJobId } from './queues';

/** Ticket mới → job phân loại bằng LLM (F06). API không chờ LLM (ADR-0004, ADR-0009). */
@Injectable()
export class TicketJobsListener {
  private readonly logger = new Logger(TicketJobsListener.name);

  constructor(@InjectQueue(TICKET_CLASSIFY_QUEUE) private readonly queue: Queue) {}

  @OnEvent(TICKET_CREATED, { async: true, suppressErrors: true })
  async handleTicketCreated(event: TicketCreatedEvent): Promise<void> {
    const data: TicketJobData = { ticketId: event.ticketId, code: event.code };
    const jobId = ticketJobId(TICKET_CLASSIFY_JOB, event.ticketId);
    try {
      await withTimeout(this.queue.add(TICKET_CLASSIFY_JOB, data, { jobId }), ENQUEUE_TIMEOUT_MS);
    } catch (error) {
      // Ticket vẫn dùng được khi chưa có nhóm; nhân viên có thể gán tay.
      this.logger.error(
        `Enqueue ${TICKET_CLASSIFY_QUEUE}/${jobId} failed (ticket ${event.code}): ${(error as Error).message}`,
      );
    }
  }
}
