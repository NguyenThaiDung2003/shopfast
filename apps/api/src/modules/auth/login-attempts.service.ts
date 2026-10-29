import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/exceptions/app.exception';
import { formatWait } from '../../common/messages/vi';
import type { EnvironmentVariables } from '../../config/env.validation';
import { LoginAttemptsRepository } from './login-attempts.repository';

const WARN_INTERVAL_MS = 10_000;

export function loginLocked(lockTtlMs: number): AppException {
  const retryAfterSeconds = Math.max(1, Math.ceil(lockTtlMs / 1000));
  return new AppException(
    HttpStatus.TOO_MANY_REQUESTS,
    'LOGIN_LOCKED',
    `Bạn đã nhập sai mật khẩu nhiều lần nên đăng nhập tạm bị khoá. Vui lòng thử lại sau ${formatWait(retryAfterSeconds)}.`,
    { retryAfterSeconds },
  );
}

/**
 * Chặn dò mật khẩu theo **email mục tiêu**, không theo IP (ADR-0008): sau N lần sai liên tiếp
 * thì khoá tăng dần (mặc định 1 → 5 → 30 phút), đăng nhập đúng thì xoá hết.
 * Redis lỗi → cho qua và log cảnh báo (bcrypt + hạn mức theo IP vẫn làm chậm việc dò).
 */
@Injectable()
export class LoginAttemptsService {
  private readonly logger = new Logger(LoginAttemptsService.name);
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly lockoutStepsMs: number[];
  private lastWarnAt = 0;

  constructor(
    private readonly loginAttemptsRepository: LoginAttemptsRepository,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.maxFailures = config.get('LOGIN_MAX_FAILED_ATTEMPTS', { infer: true });
    this.windowMs = config.get('LOGIN_FAILURE_WINDOW_SECONDS', { infer: true }) * 1000;
    this.lockoutStepsMs = config
      .get('LOGIN_LOCKOUT_STEPS_SECONDS', { infer: true })
      .split(',')
      .map((seconds) => Number(seconds) * 1000);
  }

  /** Đang khoá → 429 `LOGIN_LOCKED`, kể cả khi mật khẩu gửi lên là đúng. */
  async assertNotLocked(email: string): Promise<void> {
    const lockTtlMs = await this.safely('check', () =>
      this.loginAttemptsRepository.lockTtlMs(email),
    );
    if (lockTtlMs) throw loginLocked(lockTtlMs);
  }

  /** Ghi nhận một lần sai; nếu lần này làm khoá (hoặc đang khoá) → 429 `LOGIN_LOCKED`. */
  async recordFailure(email: string): Promise<void> {
    const lockTtlMs = await this.safely('record', () =>
      this.loginAttemptsRepository.recordFailure(email, {
        maxFailures: this.maxFailures,
        windowMs: this.windowMs,
        lockoutStepsMs: this.lockoutStepsMs,
      }),
    );
    if (lockTtlMs) throw loginLocked(lockTtlMs);
  }

  async reset(email: string): Promise<void> {
    await this.safely('reset', () => this.loginAttemptsRepository.reset(email));
  }

  private async safely<T>(operation: string, run: () => Promise<T>): Promise<T | undefined> {
    try {
      return await run();
    } catch (error) {
      const now = Date.now();
      if (now - this.lastWarnAt >= WARN_INTERVAL_MS) {
        this.lastWarnAt = now;
        this.logger.warn(
          `Login lockout ${operation} skipped, Redis unavailable: ${(error as Error).message}`,
        );
      }
      return undefined;
    }
  }
}
