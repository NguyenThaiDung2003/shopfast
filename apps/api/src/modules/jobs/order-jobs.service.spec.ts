import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, Role } from '@prisma/client';
import type { Queue } from 'bullmq';
import type { EnvironmentVariables } from '../../config/env.validation';
import { OrderCreatedEvent } from '../orders/events/order-created.event';
import { OrderStatusChangedEvent } from '../orders/events/order-status-changed.event';
import { OrderJobsService } from './order-jobs.service';

const ORDER_ID = '6f1d0c8e-0000-4000-8000-000000000001';
const created = new OrderCreatedEvent(ORDER_ID, 'SF-000123', 'u1', 2_500_000, []);
const changed = (to: OrderStatus) =>
  new OrderStatusChangedEvent(
    ORDER_ID,
    'SF-000123',
    'u1',
    OrderStatus.PENDING_PAYMENT,
    to,
    { id: 'w1', role: Role.WAREHOUSE },
    null,
  );

function queue(name: string) {
  return {
    name,
    add: jest.fn().mockResolvedValue({}),
    remove: jest.fn().mockResolvedValue(1),
  };
}

describe('OrderJobsService', () => {
  let email: ReturnType<typeof queue>;
  let invoice: ReturnType<typeof queue>;
  let inventory: ReturnType<typeof queue>;
  let service: OrderJobsService;

  beforeEach(() => {
    email = queue('email');
    invoice = queue('invoice');
    inventory = queue('inventory-sync');
    const config = { get: () => 1_800_000 } as unknown as ConfigService<EnvironmentVariables, true>;
    service = new OrderJobsService(
      email as unknown as Queue,
      invoice as unknown as Queue,
      inventory as unknown as Queue,
      config,
    );
  });

  it('order.created → email xác nhận, đồng bộ kho, nhắc thanh toán hẹn 30 phút; jobId cố định', async () => {
    await service.onOrderCreated(created);

    const data = { orderId: ORDER_ID, code: 'SF-000123' };
    expect(email.add).toHaveBeenCalledWith('order-confirmation', data, {
      jobId: `order-confirmation-${ORDER_ID}`,
    });
    expect(email.add).toHaveBeenCalledWith('payment-reminder', data, {
      delay: 1_800_000,
      jobId: `payment-reminder-${ORDER_ID}`,
    });
    expect(inventory.add).toHaveBeenCalledWith('inventory-reserve', data, {
      jobId: `inventory-reserve-${ORDER_ID}`,
    });
    expect(invoice.add).not.toHaveBeenCalled();
  });

  it('→ PAID: xuất hoá đơn và gỡ nhắc thanh toán', async () => {
    await service.onStatusChanged(changed(OrderStatus.PAID));

    expect(invoice.add).toHaveBeenCalledWith(
      'invoice',
      { orderId: ORDER_ID, code: 'SF-000123' },
      { jobId: `invoice-${ORDER_ID}` },
    );
    expect(email.remove).toHaveBeenCalledWith(`payment-reminder-${ORDER_ID}`);
    expect(inventory.add).not.toHaveBeenCalled();
  });

  it('→ CANCELLED: trả hàng cho đối tác và gỡ nhắc thanh toán', async () => {
    await service.onStatusChanged(changed(OrderStatus.CANCELLED));

    expect(inventory.add).toHaveBeenCalledWith('inventory-release', expect.anything(), {
      jobId: `inventory-release-${ORDER_ID}`,
    });
    expect(email.remove).toHaveBeenCalledWith(`payment-reminder-${ORDER_ID}`);
    expect(invoice.add).not.toHaveBeenCalled();
  });

  it('trạng thái khác → không đẩy job', async () => {
    await service.onStatusChanged(changed(OrderStatus.SHIPPING));

    expect(email.add).not.toHaveBeenCalled();
    expect(invoice.add).not.toHaveBeenCalled();
    expect(inventory.add).not.toHaveBeenCalled();
  });

  it('Redis lỗi → chỉ log, không ném; các job khác vẫn được đẩy', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    email.add.mockRejectedValue(new Error('Connection is closed.'));

    await expect(service.onOrderCreated(created)).resolves.toBeUndefined();
    expect(inventory.add).toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Connection is closed.'));
    error.mockRestore();
  });

  it('Redis treo → bỏ chờ sau 2 giây, không ném', async () => {
    jest.useFakeTimers();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    invoice.add.mockReturnValue(new Promise(() => undefined));
    email.remove.mockReturnValue(new Promise(() => undefined));

    const pending = service.onStatusChanged(changed(OrderStatus.PAID));
    await jest.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('timed out after 2000ms'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('timed out'));
    error.mockRestore();
    warn.mockRestore();
    jest.useRealTimers();
  });
});
