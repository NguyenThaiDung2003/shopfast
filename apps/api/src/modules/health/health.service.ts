import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaHealthIndicator } from '@nestjs/terminus';
import { AppException } from '../../common/exceptions/app.exception';
import type { EnvironmentVariables } from '../../config/env.validation';
import { PrismaService } from '../../database/prisma.service';
import { DependencyCheckDto, LivenessDto, ReadinessDto, SystemVersionDto } from './health.response';
import { RedisHealthIndicator } from './redis.health';
import { ShutdownService } from './shutdown.service';

/**
 * Readiness (GET /health) và liveness (GET /health/live) – ADR-0012.
 *
 * | Tình huống             | HTTP | status         |
 * | ---------------------- | ---- | -------------- |
 * | DB + Redis ổn          | 200  | ok             |
 * | Redis lỗi, DB ổn       | 200  | degraded       |  ← cache/rate limit/OTP tự suy giảm
 * | DB lỗi                 | 503  | error          |
 * | Đang tắt               | 503  | shutting_down  |  ← load balancer rút traffic
 *
 * PrismaService chỉ được dùng để truyền cho PrismaHealthIndicator (SELECT 1), không truy vấn
 * nghiệp vụ – ngoại lệ có chủ đích của luật "service không inject Prisma".
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly timeoutMs: number;
  private readonly versionInfo: SystemVersionDto;

  constructor(
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly redisIndicator: RedisHealthIndicator,
    private readonly shutdown: ShutdownService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.timeoutMs = config.get('HEALTH_CHECK_TIMEOUT_MS', { infer: true });
    this.versionInfo = {
      version: config.get('APP_VERSION', { infer: true }),
      commit: config.get('GIT_COMMIT', { infer: true }),
      environment: config.get('NODE_ENV', { infer: true }),
      nodeVersion: process.version,
    };
  }

  /** Thông tin bản build đang chạy (trang "Giám sát hệ thống"). */
  version(): SystemVersionDto {
    return this.versionInfo;
  }

  /** Tiến trình còn sống: không chạm phụ thuộc nào, kể cả khi đang tắt. */
  live(): LivenessDto {
    return { status: 'ok', uptimeSeconds: uptimeSeconds(), commit: this.versionInfo.commit };
  }

  async ready(): Promise<ReadinessDto> {
    const [database, redis] = await Promise.all([
      this.measure('database', () =>
        this.prismaIndicator.pingCheck('database', this.prisma, { timeout: this.timeoutMs }),
      ),
      this.measure('redis', () => this.redisIndicator.pingCheck('redis', this.timeoutMs)),
    ]);
    const checks = { database, redis };

    if (this.shutdown.isShuttingDown) {
      throw unavailable(
        'shutting_down',
        'Dịch vụ đang tắt để cập nhật, vui lòng thử lại sau giây lát.',
        checks,
      );
    }
    if (database.status === 'down') {
      throw unavailable(
        'error',
        'Dịch vụ tạm thời không sẵn sàng (không kết nối được cơ sở dữ liệu).',
        checks,
      );
    }
    return {
      status: redis.status === 'up' ? 'ok' : 'degraded',
      checks,
      uptimeSeconds: uptimeSeconds(),
      timestamp: new Date().toISOString(),
    };
  }

  /** Không bao giờ ném: lỗi → `down`, chi tiết hạ tầng chỉ ghi log. */
  private async measure(name: string, check: () => Promise<unknown>): Promise<DependencyCheckDto> {
    const started = Date.now();
    try {
      await check();
      return { status: 'up', latencyMs: Date.now() - started };
    } catch (error) {
      this.logger.warn(`Health check ${name} down: ${(error as Error).message}`);
      return { status: 'down', latencyMs: Date.now() - started };
    }
  }
}

function uptimeSeconds(): number {
  return Math.round(process.uptime());
}

function unavailable(
  status: 'error' | 'shutting_down',
  message: string,
  checks: Record<string, DependencyCheckDto>,
): AppException {
  return new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'SERVICE_UNAVAILABLE', message, {
    status,
    checks,
  });
}
