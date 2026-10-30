import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import { RedisHealthIndicator } from './redis.health';
import { ShutdownService } from './shutdown.service';

function setup(drainMs: number, timeoutMs: number) {
  const values: Record<string, number> = {
    SHUTDOWN_DRAIN_MS: drainMs,
    SHUTDOWN_TIMEOUT_MS: timeoutMs,
  };
  const service = new ShutdownService({
    get: (key: string) => values[key],
  } as unknown as ConfigService<EnvironmentVariables, true>);
  const exit = jest.fn();
  service.exit = exit;
  return { service, exit };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('ShutdownService', () => {
  it('onModuleDestroy bật draining ngay; drained() chỉ resolve sau SHUTDOWN_DRAIN_MS', async () => {
    const { service } = setup(5_000, 25_000);
    expect(service.isShuttingDown).toBe(false);

    service.onModuleDestroy();
    expect(service.isShuttingDown).toBe(true);

    let drained = false;
    void service.beforeApplicationShutdown().then(() => (drained = true));
    await jest.advanceTimersByTimeAsync(4_999);
    expect(drained).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(drained).toBe(true);
  });

  it('drained() gọi trước hook (module khác chạy trước) cũng bắt đầu tắt; chỉ một mốc drain', async () => {
    const { service } = setup(1_000, 25_000);
    const first = service.drained();
    await jest.advanceTimersByTimeAsync(600);
    service.onModuleDestroy(); // không khởi động lại đồng hồ
    const second = service.drained();
    expect(second).toBe(first);
    await jest.advanceTimersByTimeAsync(400);
    await expect(first).resolves.toBeUndefined();
  });

  it('quá SHUTDOWN_TIMEOUT_MS → thoát cưỡng bức với mã 1', async () => {
    const { service, exit } = setup(0, 10_000);
    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(9_999);
    expect(exit).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('tắt xong trong hạn → huỷ hẹn giờ cứng, không thoát cưỡng bức', async () => {
    const { service, exit } = setup(0, 10_000);
    service.onModuleDestroy();
    const drained = service.beforeApplicationShutdown();
    await jest.advanceTimersByTimeAsync(0);
    await drained;
    service.onApplicationShutdown('SIGTERM');
    await jest.advanceTimersByTimeAsync(20_000);
    expect(exit).not.toHaveBeenCalled();
  });

  it('onApplicationShutdown khi chưa từng bắt đầu tắt → không lỗi', () => {
    const { service } = setup(0, 10_000);
    expect(() => service.onApplicationShutdown()).not.toThrow();
  });
});

describe('RedisHealthIndicator', () => {
  it('PING ok → up; lỗi → HealthCheckError; treo → timeout', async () => {
    const ping = jest.fn().mockResolvedValueOnce('PONG').mockRejectedValueOnce(new Error('down'));
    const indicator = new RedisHealthIndicator({ ping } as never);

    await expect(indicator.pingCheck('redis', 100)).resolves.toEqual({ redis: { status: 'up' } });
    await expect(indicator.pingCheck('redis', 100)).rejects.toMatchObject({
      causes: { redis: { status: 'down' } },
    });

    ping.mockReturnValueOnce(new Promise(() => undefined));
    const hanging = indicator.pingCheck('redis', 100);
    const assertion = expect(hanging).rejects.toThrow('timeout of 100ms exceeded');
    await jest.advanceTimersByTimeAsync(100);
    await assertion;
  });
});
