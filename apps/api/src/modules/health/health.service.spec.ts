import { HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaHealthIndicator } from '@nestjs/terminus';
import { AppException } from '../../common/exceptions/app.exception';
import type { EnvironmentVariables } from '../../config/env.validation';
import { PrismaService } from '../../database/prisma.service';
import { HealthService } from './health.service';
import { RedisHealthIndicator } from './redis.health';
import { ShutdownService } from './shutdown.service';

function setup({ db = true, redis = true, shuttingDown = false } = {}) {
  const prisma = {} as PrismaService;
  const prismaIndicator = {
    pingCheck: jest.fn(() =>
      db
        ? Promise.resolve({ database: { status: 'up' } })
        : Promise.reject(new Error('ECONNREFUSED 10.0.0.9:5432')),
    ),
  };
  const redisIndicator = {
    pingCheck: jest.fn(() =>
      redis ? Promise.resolve({ redis: { status: 'up' } }) : Promise.reject(new Error('timeout')),
    ),
  };
  const shutdown = { isShuttingDown: shuttingDown };
  const config = { get: () => 800 } as unknown as ConfigService<EnvironmentVariables, true>;
  const service = new HealthService(
    prismaIndicator as unknown as PrismaHealthIndicator,
    prisma,
    redisIndicator as unknown as RedisHealthIndicator,
    shutdown as unknown as ShutdownService,
    config,
  );
  return { service, prismaIndicator, redisIndicator, prisma };
}

beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
afterEach(() => jest.restoreAllMocks());

describe('HealthService.ready', () => {
  it('DB + Redis ổn → ok, kiểm cả hai với timeout cấu hình', async () => {
    const { service, prismaIndicator, redisIndicator, prisma } = setup();

    const result = await service.ready();

    expect(result).toMatchObject({
      status: 'ok',
      checks: { database: { status: 'up' }, redis: { status: 'up' } },
    });
    expect(prismaIndicator.pingCheck).toHaveBeenCalledWith('database', prisma, { timeout: 800 });
    expect(redisIndicator.pingCheck).toHaveBeenCalledWith('redis', 800);
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
  });

  it('Redis lỗi → degraded (vẫn 200, không ném)', async () => {
    const { service } = setup({ redis: false });
    await expect(service.ready()).resolves.toMatchObject({
      status: 'degraded',
      checks: { database: { status: 'up' }, redis: { status: 'down' } },
    });
  });

  it('DB lỗi → 503 tiếng Việt, details có checks, không lộ chuỗi lỗi hạ tầng', async () => {
    const { service } = setup({ db: false });

    const error = (await service.ready().catch((e: unknown) => e)) as AppException;

    expect(error).toBeInstanceOf(AppException);
    expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(error.code).toBe('SERVICE_UNAVAILABLE');
    expect(error.userMessage).toContain('cơ sở dữ liệu');
    expect(error.details).toMatchObject({
      status: 'error',
      checks: { database: { status: 'down' } },
    });
    expect(JSON.stringify(error.details)).not.toContain('10.0.0.9');
  });

  it('đang tắt → 503 shutting_down kể cả khi mọi thứ ổn', async () => {
    const { service } = setup({ shuttingDown: true });
    await expect(service.ready()).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      details: { status: 'shutting_down' },
    });
  });
});

describe('HealthService.live', () => {
  it('không chạm DB/Redis, kể cả khi đang tắt', () => {
    const { service, prismaIndicator, redisIndicator } = setup({ db: false, shuttingDown: true });
    expect(service.live()).toMatchObject({ status: 'ok', uptimeSeconds: expect.any(Number) });
    expect(prismaIndicator.pingCheck).not.toHaveBeenCalled();
    expect(redisIndicator.pingCheck).not.toHaveBeenCalled();
  });
});
