import { ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
  ThrottlerRequest,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { AppException } from '../../common/exceptions/app.exception';
import { formatWait } from '../../common/messages/vi';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { AuthenticatedRequest } from '../auth/decorators/current-user.decorator';
import { RATE_LIMIT_POLICY_KEY } from './rate-limit.decorator';
import { GLOBAL_POLICY, RateLimitPolicy } from './rate-limit.policies';

/**
 * Guard toàn cục (ADR-0008), chạy SAU JwtAuthGuard nên đã biết user:
 * - tracker: `user:<id>` khi đã đăng nhập, `ip:<req.ip>` khi chưa (IP thật nhờ `trust proxy`);
 * - hạn mức `global` áp mọi route, các hạn mức khác chỉ áp route có `@RateLimit(tên)`;
 * - vượt hạn mức → 429 tiếng Việt kèm số giây, filter đặt header `Retry-After`.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly enabled: boolean;

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    super(options, storageService, reflector);
    this.enabled = config.get('RATE_LIMIT_ENABLED', { infer: true });
  }

  /** Chỉ đếm request HTTP; message WebSocket không đi qua hạn mức này (ADR-0010). */
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    return !this.enabled || context.getType() !== 'http';
  }

  protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { context, throttler } = requestProps;
    if (throttler.name !== GLOBAL_POLICY) {
      const policy = this.reflector.getAllAndOverride<RateLimitPolicy | undefined>(
        RATE_LIMIT_POLICY_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (policy !== throttler.name) return true;
    }
    return super.handleRequest(requestProps);
  }

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const { user, ip } = req as unknown as AuthenticatedRequest;
    return user ? `user:${user.id}` : `ip:${ip ?? 'unknown'}`;
  }

  /** Không kèm tên route: hạn mức chung đếm gộp toàn API, hạn mức riêng đếm theo policy. */
  protected override generateKey(
    _context: ExecutionContext,
    tracker: string,
    name: string,
  ): string {
    return `ratelimit:${name}:${tracker}`;
  }

  protected override async throwThrottlingException(
    _context: ExecutionContext,
    { timeToBlockExpire }: ThrottlerLimitDetail,
  ): Promise<void> {
    const retryAfterSeconds = Math.max(1, timeToBlockExpire);
    throw new AppException(
      HttpStatus.TOO_MANY_REQUESTS,
      'TOO_MANY_REQUESTS',
      `Bạn thao tác quá nhanh, vui lòng thử lại sau ${formatWait(retryAfterSeconds)}.`,
      { retryAfterSeconds },
    );
  }
}
