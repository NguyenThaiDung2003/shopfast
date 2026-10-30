import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@prisma/client';
import type { EnvironmentVariables } from '../../config/env.validation';
import { InvoiceService } from './invoice.service';
import { JobsRepository, OrderForJob } from './jobs.repository';

const order: OrderForJob = {
  id: 'o1',
  code: 'SF-000777',
  status: OrderStatus.PAID,
  totalAmount: 1_990_000,
  paidAt: new Date('2026-10-29T05:00:00Z'),
  createdAt: new Date('2026-10-29T04:00:00Z'),
  user: { email: 'khach@shopfast.local', fullName: 'Nguyễn Thị Hằng' },
  items: [{ quantity: 1, unitPrice: 1_990_000, product: { sku: 'SKU-9', name: 'Bàn phím cơ' } }],
};

describe('InvoiceService', () => {
  let dir: string;
  let jobs: jest.Mocked<Pick<JobsRepository, 'findOrder'>>;
  let service: InvoiceService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shopfast-invoice-'));
    jobs = { findOrder: jest.fn().mockResolvedValue(order) };
    const config = { get: () => dir } as unknown as ConfigService<EnvironmentVariables, true>;
    service = new InvoiceService(jobs as unknown as JobsRepository, config);
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('đơn đã thanh toán → ghi <mã đơn>.pdf (PDF hợp lệ, có font nhúng cho tiếng Việt)', async () => {
    const result = await service.generate('o1');

    expect(result).toMatchObject({ status: 'generated', file: join(dir, 'SF-000777.pdf') });
    const pdf = await readFile(join(dir, 'SF-000777.pdf'));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('DejaVuSans');
  });

  it('chạy lại → vẫn đúng một file, không để lại file tạm', async () => {
    await service.generate('o1');
    await service.generate('o1');

    expect(await readdir(dir)).toEqual(['SF-000777.pdf']);
  });

  it.each([OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED])(
    'đơn %s → bỏ qua, không tạo file',
    async (status) => {
      jobs.findOrder.mockResolvedValue({ ...order, status });

      await expect(service.generate('o1')).resolves.toEqual({
        status: 'skipped',
        reason: `status_${status}`,
      });
      expect(await readdir(dir)).toEqual([]);
    },
  );

  it('đơn không tồn tại → UnrecoverableError', async () => {
    jobs.findOrder.mockResolvedValue(null);

    await expect(service.generate('x')).rejects.toMatchObject({ name: 'UnrecoverableError' });
  });
});
