import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@prisma/client';
import type { EnvironmentVariables } from '../../config/env.validation';
import { InventorySyncService } from './inventory-sync.service';
import { JobsRepository, OrderForJob } from './jobs.repository';
import {
  FakePartnerInventoryClient,
  PartnerInventoryClient,
  PartnerUnavailableError,
} from './partner-inventory.client';

const order = {
  id: 'o1',
  code: 'SF-000001',
  status: OrderStatus.PENDING_PAYMENT,
  items: [
    { quantity: 2, unitPrice: 100, product: { sku: 'A', name: 'A' } },
    { quantity: 1, unitPrice: 200, product: { sku: 'B', name: 'B' } },
  ],
} as unknown as OrderForJob;

describe('InventorySyncService', () => {
  let jobs: jest.Mocked<Pick<JobsRepository, 'findOrder'>>;
  let partner: jest.Mocked<PartnerInventoryClient>;
  let service: InventorySyncService;

  beforeEach(() => {
    jobs = { findOrder: jest.fn().mockResolvedValue(order) };
    partner = { pushStockChange: jest.fn().mockResolvedValue(undefined) };
    service = new InventorySyncService(jobs as unknown as JobsRepository, partner);
  });

  it('reserve → gửi đúng sku/số lượng kèm khoá chống trùng', async () => {
    await expect(service.sync('inventory-reserve', 'o1', 'inventory-reserve-o1')).resolves.toEqual({
      status: 'synced',
      items: 2,
    });
    expect(partner.pushStockChange).toHaveBeenCalledWith({
      idempotencyKey: 'inventory-reserve-o1',
      orderCode: 'SF-000001',
      action: 'reserve',
      items: [
        { sku: 'A', quantity: 2 },
        { sku: 'B', quantity: 1 },
      ],
    });
  });

  it('release → action release', async () => {
    await service.sync('inventory-release', 'o1', 'k');
    expect(partner.pushStockChange.mock.calls[0]![0].action).toBe('release');
  });

  it('đối tác lỗi → ném để BullMQ thử lại', async () => {
    partner.pushStockChange.mockRejectedValue(new PartnerUnavailableError());

    await expect(service.sync('inventory-reserve', 'o1', 'k')).rejects.toThrow('503');
  });

  it('đơn không tồn tại → UnrecoverableError', async () => {
    jobs.findOrder.mockResolvedValue(null);

    await expect(service.sync('inventory-reserve', 'x', 'k')).rejects.toMatchObject({
      name: 'UnrecoverableError',
    });
  });
});

describe('FakePartnerInventoryClient', () => {
  const change = {
    idempotencyKey: 'k1',
    orderCode: 'SF-1',
    action: 'reserve' as const,
    items: [{ sku: 'A', quantity: 1 }],
  };

  function client(failureRate: number, roll: number) {
    const env: Record<string, number> = {
      PARTNER_FAILURE_RATE: failureRate,
      PARTNER_LATENCY_MS: 0,
    };
    const config = {
      get: (key: string) => env[key],
    } as unknown as ConfigService<EnvironmentVariables, true>;
    const fake = new FakePartnerInventoryClient(config);
    jest.spyOn(fake as unknown as { random: () => number }, 'random').mockReturnValue(roll);
    return fake;
  }

  it('lỗi ngẫu nhiên theo tỉ lệ cấu hình', async () => {
    await expect(client(0.3, 0.29).pushStockChange(change)).rejects.toBeInstanceOf(
      PartnerUnavailableError,
    );
    await expect(client(0.3, 0.3).pushStockChange(change)).resolves.toBeUndefined();
  });

  it('PARTNER_FAILURE_RATE=0 → không bao giờ lỗi; =1 → luôn lỗi', async () => {
    await expect(client(0, 0).pushStockChange(change)).resolves.toBeUndefined();
    await expect(client(1, 0.999).pushStockChange(change)).rejects.toThrow();
  });
});
