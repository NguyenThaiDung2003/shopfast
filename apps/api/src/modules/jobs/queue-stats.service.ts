import { InjectQueue } from '@nestjs/bullmq';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AppException } from '../../common/exceptions/app.exception';
import { accessTokenRemainingMs } from '../auth/token.service';
import { QueuesStatsDto } from './dto/queue-stats.response';
import {
  DEAD_LETTER_QUEUE,
  EMAIL_QUEUE,
  INVENTORY_SYNC_QUEUE,
  INVOICE_QUEUE,
  TICKET_CLASSIFY_QUEUE,
} from './queues';

const STATS_TIMEOUT_MS = 2_000;

/** Thống kê job cho admin (Bull Board hiển thị cùng các số này). */
@Injectable()
export class QueueStatsService {
  private readonly logger = new Logger(QueueStatsService.name);
  private readonly queues: Queue[];

  constructor(
    @InjectQueue(EMAIL_QUEUE) email: Queue,
    @InjectQueue(INVOICE_QUEUE) invoice: Queue,
    @InjectQueue(INVENTORY_SYNC_QUEUE) inventorySync: Queue,
    @InjectQueue(TICKET_CLASSIFY_QUEUE) ticketClassify: Queue,
    @InjectQueue(DEAD_LETTER_QUEUE) deadLetter: Queue,
  ) {
    this.queues = [email, invoice, inventorySync, ticketClassify, deadLetter];
  }

  async getStats(): Promise<QueuesStatsDto> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const counts = await Promise.race([
        Promise.all(
          this.queues.map((q) =>
            q.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed'),
          ),
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timed out')), STATS_TIMEOUT_MS);
        }),
      ]);
      return {
        queues: this.queues.map((q, i) => ({
          name: q.name,
          waiting: counts[i]!.waiting ?? 0,
          active: counts[i]!.active ?? 0,
          delayed: counts[i]!.delayed ?? 0,
          completed: counts[i]!.completed ?? 0,
          failed: counts[i]!.failed ?? 0,
        })),
      };
    } catch (error) {
      this.logger.error(`Queue stats unavailable: ${(error as Error).message}`);
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SERVICE_UNAVAILABLE',
        'Không đọc được trạng thái hàng đợi, vui lòng thử lại sau.',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Số giây còn lại của access token (đã được JwtAuthGuard kiểm), làm Max-Age cho cookie. */
  sessionMaxAgeMs(accessToken: string, now = Date.now()): number {
    return accessTokenRemainingMs(accessToken, now);
  }
}
