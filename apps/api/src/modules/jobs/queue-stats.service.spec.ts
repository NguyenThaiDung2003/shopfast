import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QueueStatsService } from './queue-stats.service';
import { addDays, dateInZone, dayRange, reportDate } from './report-period';

function queue(name: string, counts: Record<string, number>) {
  return { name, getJobCounts: jest.fn().mockResolvedValue(counts) } as unknown as Queue;
}

describe('QueueStatsService', () => {
  it('trả số job theo trạng thái của 4 queue, thiếu trạng thái = 0', async () => {
    const service = new QueueStatsService(
      queue('email', { waiting: 2, active: 1, delayed: 5, completed: 10, failed: 0 }),
      queue('invoice', { completed: 3 }),
      queue('inventory-sync', { failed: 1 }),
      queue('dead-letter', { waiting: 1 }),
    );

    const { queues } = await service.getStats();

    expect(queues).toEqual([
      { name: 'email', waiting: 2, active: 1, delayed: 5, completed: 10, failed: 0 },
      { name: 'invoice', waiting: 0, active: 0, delayed: 0, completed: 3, failed: 0 },
      { name: 'inventory-sync', waiting: 0, active: 0, delayed: 0, completed: 0, failed: 1 },
      { name: 'dead-letter', waiting: 1, active: 0, delayed: 0, completed: 0, failed: 0 },
    ]);
  });

  it('Redis lỗi → 503 tiếng Việt', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const broken = {
      name: 'email',
      getJobCounts: jest.fn().mockRejectedValue(new Error('down')),
    } as unknown as Queue;
    const service = new QueueStatsService(broken, broken, broken, broken);

    await expect(service.getStats()).rejects.toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
    error.mockRestore();
  });

  it('sessionMaxAgeMs = thời gian còn lại của access token', () => {
    const service = new QueueStatsService(
      ...([0, 1, 2, 3].map(() => queue('q', {})) as [Queue, Queue, Queue, Queue]),
    );
    const payload = Buffer.from(JSON.stringify({ sub: 'a', exp: 1_000 })).toString('base64url');

    expect(service.sessionMaxAgeMs(`h.${payload}.s`, 400_000)).toBe(600_000);
    expect(service.sessionMaxAgeMs(`h.${payload}.s`, 2_000_000)).toBe(0);
  });
});

describe('report-period', () => {
  const VN = 'Asia/Ho_Chi_Minh';

  it('ngày theo múi giờ VN khác ngày UTC quanh nửa đêm', () => {
    expect(dateInZone(new Date('2026-10-29T16:59:59Z'), VN)).toBe('2026-10-29');
    expect(dateInZone(new Date('2026-10-29T17:00:00Z'), VN)).toBe('2026-10-30');
  });

  it('addDays qua ranh giới tháng/năm', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(() => addDays('30/10/2026', 1)).toThrow();
  });

  it('dayRange: 00:00–24:00 giờ VN = 17:00 UTC hôm trước → 17:00 UTC', () => {
    expect(dayRange('2026-10-29', VN)).toEqual({
      from: new Date('2026-10-28T17:00:00Z'),
      to: new Date('2026-10-29T17:00:00Z'),
    });
  });

  it('dayRange đúng cả múi giờ có đổi giờ mùa hè (ngày 23 giờ)', () => {
    const { from, to } = dayRange('2026-03-08', 'America/New_York');
    expect(from.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(to.getTime() - from.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it('reportDate: mặc định hôm qua theo múi giờ, hoặc ngày được chỉ định', () => {
    expect(reportDate(new Date('2026-10-29T17:00:00Z'), VN)).toBe('2026-10-29');
    expect(reportDate(new Date(), VN, '2026-01-15')).toBe('2026-01-15');
  });
});
