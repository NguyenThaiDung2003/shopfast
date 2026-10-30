import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { json, loginAs, fakeApi } from '../test/fake-api';
import { fetchHealth } from './system-api';
import {
  cacheRateTone,
  dependencyView,
  formatPercent,
  formatUptime,
  parseRefresh,
  queueProblemCount,
  refreshInterval,
} from './system-view';

const queue = { waiting: 15, active: 0, delayed: 0, completed: 0, failed: 2 };

describe('system-view', () => {
  it('DB lỗi là mất kết nối, Redis lỗi chỉ suy giảm', () => {
    const down = { status: 'down', latencyMs: 1 } as const;
    expect(dependencyView(down, true).label).toBe('Mất kết nối');
    expect(dependencyView(down, false).label).toBe('Suy giảm');
    expect(dependencyView({ status: 'up', latencyMs: 1 }, true).tone).toBe('success');
  });

  it('job nằm ở dead-letter cũng tính là lỗi', () => {
    expect(queueProblemCount({ name: 'dead-letter', ...queue })).toBe(17);
    expect(queueProblemCount({ name: 'email', ...queue })).toBe(2);
  });

  it('tone cache theo mục tiêu 85%, chưa có lượt đọc thì không đánh giá', () => {
    expect(cacheRateTone(0.9, 10)).toBe('success');
    expect(cacheRateTone(0.5, 10)).toBe('warning');
    expect(cacheRateTone(0, 0)).toBe('neutral');
  });

  it('định dạng', () => {
    expect(formatPercent(0.864)).toBe('86,4%');
    expect(formatUptime(45)).toBe('45 giây');
    expect(formatUptime(720)).toBe('12 phút');
    expect(formatUptime(11_100)).toBe('3 giờ 5 phút');
    expect(formatUptime(187_200)).toBe('2 ngày 4 giờ');
  });

  it('chu kỳ làm mới', () => {
    expect(parseRefresh('30')).toBe('30');
    expect(parseRefresh('7')).toBe('10');
    expect(parseRefresh(null)).toBe('10');
    expect(refreshInterval('30')).toBe(30_000);
    expect(refreshInterval('off')).toBe(false);
  });
});

describe('api client – option root', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('/health đi ngoài /api và không gắn token', async () => {
    loginAs('ADMIN');
    fakeApi({ 'GET /health': () => json({ status: 'ok' }) });
    await fetchHealth();
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/health');
    expect((init!.headers as Record<string, string>).Authorization).toBeUndefined();

    await api.get('/admin/system/version').catch(() => undefined);
    expect(vi.mocked(fetch).mock.calls[1]![0]).toBe('/api/admin/system/version');
  });
});
