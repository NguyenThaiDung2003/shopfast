import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import { LoginAttemptsRepository } from './login-attempts.repository';
import { LoginAttemptsService } from './login-attempts.service';

const EMAIL = 'khach@shopfast.local';
const env: Record<string, unknown> = {
  LOGIN_MAX_FAILED_ATTEMPTS: 5,
  LOGIN_FAILURE_WINDOW_SECONDS: 900,
  LOGIN_LOCKOUT_STEPS_SECONDS: '60,300,1800',
};

describe('LoginAttemptsService', () => {
  let repository: jest.Mocked<
    Pick<LoginAttemptsRepository, 'lockTtlMs' | 'recordFailure' | 'reset'>
  >;
  let service: LoginAttemptsService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    repository = {
      lockTtlMs: jest.fn().mockResolvedValue(0),
      recordFailure: jest.fn().mockResolvedValue(0),
      reset: jest.fn().mockResolvedValue(undefined),
    };
    const config = { get: (key: string) => env[key] } as unknown as ConfigService<
      EnvironmentVariables,
      true
    >;
    service = new LoginAttemptsService(repository as unknown as LoginAttemptsRepository, config);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  it('chưa khoá → cho qua', async () => {
    await expect(service.assertNotLocked(EMAIL)).resolves.toBeUndefined();
    expect(repository.lockTtlMs).toHaveBeenCalledWith(EMAIL);
  });

  it('đang khoá → 429 LOGIN_LOCKED, làm tròn lên số giây và kèm số phút', async () => {
    repository.lockTtlMs.mockResolvedValue(299_001);

    await expect(service.assertNotLocked(EMAIL)).rejects.toMatchObject({
      status: 429,
      code: 'LOGIN_LOCKED',
      details: { retryAfterSeconds: 300 },
      userMessage: expect.stringContaining('300 giây (khoảng 5 phút)'),
    });
  });

  it('ghi nhận lần sai với cấu hình từ env (đổi sang ms)', async () => {
    await expect(service.recordFailure(EMAIL)).resolves.toBeUndefined();

    expect(repository.recordFailure).toHaveBeenCalledWith(EMAIL, {
      maxFailures: 5,
      windowMs: 900_000,
      lockoutStepsMs: [60_000, 300_000, 1_800_000],
    });
  });

  it('lần sai làm khoá → 429 LOGIN_LOCKED', async () => {
    repository.recordFailure.mockResolvedValue(60_000);

    await expect(service.recordFailure(EMAIL)).rejects.toMatchObject({
      code: 'LOGIN_LOCKED',
      details: { retryAfterSeconds: 60 },
    });
  });

  it('reset xoá bộ đếm của email', async () => {
    await service.reset(EMAIL);
    expect(repository.reset).toHaveBeenCalledWith(EMAIL);
  });

  it('Redis lỗi → cho qua cả ba thao tác, log cảnh báo có giới hạn tần suất', async () => {
    const down = new Error('Connection is closed.');
    repository.lockTtlMs.mockRejectedValue(down);
    repository.recordFailure.mockRejectedValue(down);
    repository.reset.mockRejectedValue(down);

    await expect(service.assertNotLocked(EMAIL)).resolves.toBeUndefined();
    await expect(service.recordFailure(EMAIL)).resolves.toBeUndefined();
    await expect(service.reset(EMAIL)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('Connection is closed.');
  });
});
