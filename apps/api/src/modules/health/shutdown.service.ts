import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';

/**
 * Điều phối tắt êm (ADR-0012). Thứ tự hook của Nest 10 khi `app.close()` / SIGTERM:
 *
 *   onModuleDestroy → beforeApplicationShutdown → đóng HTTP + Socket.IO → onApplicationShutdown
 *
 * 1. onModuleDestroy (hook đầu tiên): bật cờ draining → GET /health trả 503 để load balancer
 *    rút traffic; bắt đầu đếm SHUTDOWN_DRAIN_MS; hẹn giờ cứng SHUTDOWN_TIMEOUT_MS.
 * 2. beforeApplicationShutdown: chờ hết drain. Worker BullMQ chờ mốc này (`drained()`) rồi mới
 *    đóng, đợi job đang chạy xong – DB/Redis vẫn mở.
 * 3. Nest đóng HTTP server: Node 20 chờ request đang chạy, đóng kết nối keep-alive rảnh.
 * 4. onApplicationShutdown: PrismaService / REDIS_CLIENT mới đóng kết nối.
 */
@Injectable()
export class ShutdownService
  implements OnModuleDestroy, BeforeApplicationShutdown, OnApplicationShutdown
{
  private readonly logger = new Logger(ShutdownService.name);
  private readonly drainMs: number;
  private readonly timeoutMs: number;
  private startedAt: number | null = null;
  private drainedPromise: Promise<void> | null = null;
  private hardTimer: NodeJS.Timeout | null = null;

  /** Thoát process khi quá hạn; test thay bằng hàm giả. */
  exit: (code: number) => void = (code) => process.exit(code);

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.drainMs = config.get('SHUTDOWN_DRAIN_MS', { infer: true });
    this.timeoutMs = config.get('SHUTDOWN_TIMEOUT_MS', { infer: true });
  }

  /** true từ lúc bắt đầu tắt: readiness trả 503, không nhận traffic mới. */
  get isShuttingDown(): boolean {
    return this.startedAt !== null;
  }

  /**
   * Resolve khi hết thời gian drain. Gọi trước khi bắt đầu tắt thì cũng bắt đầu tắt luôn
   * (hook của module khác có thể chạy trước hook của service này).
   */
  drained(): Promise<void> {
    this.begin();
    return this.drainedPromise!;
  }

  onModuleDestroy(): void {
    this.begin();
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.drained();
  }

  onApplicationShutdown(signal?: string): void {
    if (this.hardTimer) clearTimeout(this.hardTimer);
    this.hardTimer = null;
    if (this.startedAt !== null) {
      this.logger.log(
        `Shutdown complete in ${Date.now() - this.startedAt}ms${signal ? ` (${signal})` : ''}`,
      );
    }
  }

  private begin(): void {
    if (this.startedAt !== null) return;
    this.startedAt = Date.now();
    this.logger.log(`Shutdown: draining for ${this.drainMs}ms (health → 503)`);
    this.drainedPromise = new Promise((resolve) => {
      // unref: test/app đóng sớm không bị giữ lại bởi timer này.
      setTimeout(resolve, this.drainMs).unref();
    });
    this.hardTimer = setTimeout(() => {
      this.logger.error(`Shutdown exceeded ${this.timeoutMs}ms, forcing exit`);
      this.exit(1);
    }, this.timeoutMs);
    this.hardTimer.unref();
  }
}
