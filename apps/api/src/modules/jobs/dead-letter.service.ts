import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { DEAD_LETTER_QUEUE, DeadLetterData } from './queues';

/**
 * BullMQ không có dead-letter queue sẵn: khi job hết lượt thử (hoặc lỗi không thể thử lại),
 * chép sang queue `dead-letter` kèm lý do để xem trên Bull Board và xử lý tay (ADR-0009).
 */
@Injectable()
export class DeadLetterService {
  private readonly logger = new Logger(DeadLetterService.name);

  constructor(@InjectQueue(DEAD_LETTER_QUEUE) private readonly deadLetterQueue: Queue) {}

  /** Gọi từ sự kiện `failed` của worker (phát sau MỖI lần thử lỗi). Trả true nếu đã chuyển. */
  async handleFailed(queue: string, job: Job | undefined, error: Error): Promise<boolean> {
    if (!job) return false;
    const maxAttempts = job.opts.attempts ?? 1;
    const unrecoverable = error.name === 'UnrecoverableError';
    if (job.attemptsMade < maxAttempts && !unrecoverable) return false;

    const data: DeadLetterData = {
      queue,
      jobName: job.name,
      jobId: job.id,
      data: job.data,
      failedReason: error.message,
      stacktrace: job.stacktrace ?? [],
      attemptsMade: job.attemptsMade,
      failedAt: new Date().toISOString(),
    };
    try {
      // jobId cố định: sự kiện `failed` lặp lại không tạo bản dead-letter thứ hai.
      await this.deadLetterQueue.add(job.name, data, {
        jobId: `${queue}-${String(job.id).replace(/:/g, '_')}`,
      });
      this.logger.error(
        `Job ${queue}/${job.name} #${job.id} moved to dead-letter after ${job.attemptsMade} attempt(s): ${error.message}`,
      );
      return true;
    } catch (dlqError) {
      // Job vẫn nằm ở trạng thái failed của queue gốc, không mất.
      this.logger.error(
        `Could not dead-letter ${queue}/${job.name} #${job.id}: ${(dlqError as Error).message}`,
      );
      return false;
    }
  }
}
