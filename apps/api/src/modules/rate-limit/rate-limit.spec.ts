import { ExecutionContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import { Reflector } from '@nestjs/core';
import type { ThrottlerOptions, ThrottlerStorage } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { parseTrustProxy } from '../../app.setup';
import { formatWait } from '../../common/messages/vi';
import { AppThrottlerGuard } from './app-throttler.guard';
import { RATE_LIMIT_POLICY_KEY } from './rate-limit.decorator';
import { parseLimit } from './rate-limit.policies';
import { RedisThrottlerStorage } from './redis-throttler.storage';

describe('rate limit – hàm thuần', () => {
  it('parseLimit đọc "<limit>/<giây>"', () => {
    expect(parseLimit('10/60')).toEqual({ limit: 10, ttlMs: 60_000 });
    expect(() => parseLimit('10')).toThrow();
    expect(() => parseLimit('0/60')).toThrow();
  });

  it('parseTrustProxy đổi chuỗi env sang giá trị Express', () => {
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('10.0.0.0/8, 127.0.0.1')).toBe('10.0.0.0/8, 127.0.0.1');
  });

  it('formatWait thêm số phút khi từ 1 phút trở lên', () => {
    expect(formatWait(45)).toBe('45 giây');
    expect(formatWait(1800)).toBe('1800 giây (khoảng 30 phút)');
  });
});

describe('RedisThrottlerStorage', () => {
  it('trả số lần gọi và thời gian còn lại theo giây (làm tròn lên)', async () => {
    const redis = { eval: jest.fn().mockResolvedValue([11, 41_200, 59_001]) };
    const storage = new RedisThrottlerStorage(redis as unknown as Redis);

    await expect(storage.increment('k', 60_000, 10, 60_000)).resolves.toEqual({
      totalHits: 11,
      timeToExpire: 42,
      isBlocked: true,
      timeToBlockExpire: 60,
    });
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      'k',
      'k:block',
      60_000,
      10,
      60_000,
    );
  });

  it('Redis lỗi → cho qua (không chặn) và log cảnh báo', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const redis = { eval: jest.fn().mockRejectedValue(new Error('Command timed out')) };
    const storage = new RedisThrottlerStorage(redis as unknown as Redis);

    await expect(storage.increment('k', 60_000, 10, 60_000)).resolves.toMatchObject({
      isBlocked: false,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Command timed out'));
    warn.mockRestore();
  });
});

describe('AppThrottlerGuard', () => {
  const throttlers: ThrottlerOptions[] = [
    { name: 'global', limit: 100, ttl: 60_000 },
    { name: 'login', limit: 2, ttl: 60_000 },
  ];

  function setup(opts: { policy?: string; enabled?: boolean; blocked?: boolean } = {}) {
    const storage = {
      increment: jest.fn().mockResolvedValue({
        totalHits: 1,
        timeToExpire: 60,
        isBlocked: opts.blocked ?? false,
        timeToBlockExpire: opts.blocked ? 42 : 0,
      }),
    };
    const reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key) => (key === RATE_LIMIT_POLICY_KEY ? opts.policy : undefined));
    const config = { get: () => opts.enabled ?? true } as unknown as ConfigService<
      EnvironmentVariables,
      true
    >;
    const guard = new AppThrottlerGuard(
      { throttlers },
      storage as unknown as ThrottlerStorage,
      reflector,
      config,
    );
    return { guard, storage };
  }

  function context(req: Record<string, unknown>): ExecutionContext {
    return {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
    } as unknown as ExecutionContext;
  }

  it('chỉ áp hạn mức chung cho route không gắn @RateLimit, key theo IP khi chưa đăng nhập', async () => {
    const { guard, storage } = setup();
    await guard.onModuleInit();

    await expect(guard.canActivate(context({ ip: '10.0.0.1', headers: {} }))).resolves.toBe(true);
    expect(storage.increment).toHaveBeenCalledTimes(1);
    expect(storage.increment.mock.calls[0][0]).toBe('ratelimit:global:ip:10.0.0.1');
  });

  it('route gắn @RateLimit("login") đếm thêm hạn mức riêng; đã đăng nhập thì key theo userId', async () => {
    const { guard, storage } = setup({ policy: 'login' });
    await guard.onModuleInit();

    await guard.canActivate(context({ ip: '10.0.0.1', headers: {}, user: { id: 'u1' } }));
    expect(storage.increment.mock.calls.map((call) => call[0])).toEqual([
      'ratelimit:global:user:u1',
      'ratelimit:login:user:u1',
    ]);
  });

  it('vượt hạn mức → 429 tiếng Việt kèm số giây', async () => {
    const { guard } = setup({ blocked: true });
    await guard.onModuleInit();

    await expect(guard.canActivate(context({ ip: '10.0.0.1', headers: {} }))).rejects.toMatchObject(
      {
        status: 429,
        code: 'TOO_MANY_REQUESTS',
        details: { retryAfterSeconds: 42 },
        userMessage: 'Bạn thao tác quá nhanh, vui lòng thử lại sau 42 giây.',
      },
    );
  });

  it('RATE_LIMIT_ENABLED=false → không đếm', async () => {
    const { guard, storage } = setup({ enabled: false });
    await guard.onModuleInit();

    await expect(guard.canActivate(context({ ip: '10.0.0.1', headers: {} }))).resolves.toBe(true);
    expect(storage.increment).not.toHaveBeenCalled();
  });
});
