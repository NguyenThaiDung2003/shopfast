import { Logger } from '@nestjs/common';
import { Job, Queue, UnrecoverableError } from 'bullmq';
import { DeadLetterService } from './dead-letter.service';

function job(attemptsMade: number, attempts = 3, id = 'inventory-reserve-o1'): Job {
  return {
    id,
    name: 'inventory-reserve',
    data: { orderId: 'o1', code: 'SF-000001' },
    opts: { attempts },
    attemptsMade,
    stacktrace: ['Error: 503\n    at partner'],
  } as unknown as Job;
}

describe('DeadLetterService', () => {
  let queue: { add: jest.Mock };
  let service: DeadLetterService;
  let logError: jest.SpyInstance;

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue({}) };
    service = new DeadLetterService(queue as unknown as Queue);
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => logError.mockRestore());

  it('còn lượt thử → không chuyển', async () => {
    await expect(service.handleFailed('inventory-sync', job(2), new Error('503'))).resolves.toBe(
      false,
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('hết lượt thử → chuyển sang dead-letter kèm lý do, số lần thử và dữ liệu gốc', async () => {
    await expect(service.handleFailed('inventory-sync', job(3), new Error('503'))).resolves.toBe(
      true,
    );

    expect(queue.add).toHaveBeenCalledWith(
      'inventory-reserve',
      expect.objectContaining({
        queue: 'inventory-sync',
        jobName: 'inventory-reserve',
        jobId: 'inventory-reserve-o1',
        data: { orderId: 'o1', code: 'SF-000001' },
        failedReason: '503',
        attemptsMade: 3,
        stacktrace: ['Error: 503\n    at partner'],
      }),
      { jobId: 'inventory-sync-inventory-reserve-o1' },
    );
  });

  it('UnrecoverableError → chuyển ngay dù còn lượt', async () => {
    await expect(
      service.handleFailed('email', job(1, 5), new UnrecoverableError('Order o1 not found')),
    ).resolves.toBe(true);
  });

  it('jobId có ":" (job do scheduler sinh) → đổi thành "_" vì BullMQ cấm ":"', async () => {
    await service.handleFailed('email', job(5, 5, 'repeat:abc:1730000000000'), new Error('x'));

    expect(queue.add.mock.calls[0][2]).toEqual({ jobId: 'email-repeat_abc_1730000000000' });
  });

  it('không có job (worker báo lỗi chung) → bỏ qua', async () => {
    await expect(service.handleFailed('email', undefined, new Error('x'))).resolves.toBe(false);
  });

  it('không ghi được dead-letter → log, không ném (job vẫn ở trạng thái failed)', async () => {
    queue.add.mockRejectedValue(new Error('Redis down'));

    await expect(service.handleFailed('email', job(3), new Error('x'))).resolves.toBe(false);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('Redis down'));
  });
});
