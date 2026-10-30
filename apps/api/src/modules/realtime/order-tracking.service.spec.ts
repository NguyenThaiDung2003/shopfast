import { HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, Role } from '@prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { AuthUser } from '../auth/auth.types';
import type { TokenService } from '../auth/token.service';
import { OrderStatusChangedEvent } from '../orders/events/order-status-changed.event';
import type { OrdersService } from '../orders/orders.service';
import { OrderRealtimeListener } from './order-realtime.listener';
import { OrderTrackingService, toOrderUpdatedPayload } from './order-tracking.service';
import type { OrdersGateway } from './orders.gateway';
import { orderRoom, subscribedOrderIds } from './realtime.events';

const customer: AuthUser = { id: 'cust-1', role: Role.CUSTOMER };
const ORDER_ID = '0b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d';
const OTHER_ID = '1c8d2e3f-4051-4b6c-9d7e-8f9a0b1c2d3e';

function setup(maxSubscriptions = 2) {
  const tokenService = { verifyAccessToken: jest.fn().mockResolvedValue(customer) };
  const ordersService = {
    findOne: jest.fn().mockResolvedValue({
      id: ORDER_ID,
      code: 'SF-000001',
      status: OrderStatus.PENDING_PAYMENT,
    }),
  };
  const config = { get: () => maxSubscriptions } as unknown as ConfigService<
    EnvironmentVariables,
    true
  >;
  const service = new OrderTrackingService(
    tokenService as unknown as TokenService,
    ordersService as unknown as OrdersService,
    config,
  );
  return { service, tokenService, ordersService };
}

/** JWT giả chỉ cần phần payload có `exp` (chữ ký đã được tokenService mock kiểm). */
function tokenExpiringAt(expSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ sub: customer.id, exp: expSeconds })).toString(
    'base64url',
  );
  return `h.${payload}.s`;
}

describe('OrderTrackingService', () => {
  describe('authenticate (handshake)', () => {
    it('token hợp lệ → user + thời gian còn lại tới exp', async () => {
      const { service, tokenService } = setup();
      const token = tokenExpiringAt(1_000);

      await expect(service.authenticate(token, 400_000)).resolves.toEqual({
        user: customer,
        expiresInMs: 600_000,
      });
      expect(tokenService.verifyAccessToken).toHaveBeenCalledWith(token);
    });

    it('thiếu token → 401 UNAUTHENTICATED, không gọi verify', async () => {
      const { service, tokenService } = setup();

      await expect(service.authenticate(undefined)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
      expect(tokenService.verifyAccessToken).not.toHaveBeenCalled();
    });

    it('token sai/hết hạn → lỗi của TokenService đi thẳng ra', async () => {
      const { service, tokenService } = setup();
      tokenService.verifyAccessToken.mockRejectedValue(
        new AppException(HttpStatus.UNAUTHORIZED, 'TOKEN_EXPIRED', 'hết hạn'),
      );

      await expect(service.authenticate('x.y.z')).rejects.toMatchObject({
        code: 'TOKEN_EXPIRED',
      });
    });
  });

  describe('subscribe', () => {
    it('được phép → ok kèm trạng thái hiện tại; kiểm quyền bằng OrdersService.findOne', async () => {
      const { service, ordersService } = setup();

      await expect(service.subscribe(customer, ORDER_ID, [])).resolves.toEqual({
        ok: true,
        order: { id: ORDER_ID, code: 'SF-000001', status: OrderStatus.PENDING_PAYMENT },
      });
      expect(ordersService.findOne).toHaveBeenCalledWith(customer, ORDER_ID);
    });

    it('đơn của người khác → ORDER_NOT_FOUND tiếng Việt', async () => {
      const { service, ordersService } = setup();
      ordersService.findOne.mockRejectedValue(
        new AppException(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng.'),
      );

      await expect(service.subscribe(customer, ORDER_ID, [])).resolves.toEqual({
        ok: false,
        error: { code: 'ORDER_NOT_FOUND', message: 'Không tìm thấy đơn hàng.' },
      });
    });

    it.each([undefined, 42, 'abc', ''])(
      'orderId %p không phải UUID → VALIDATION_FAILED',
      async (id) => {
        const { service, ordersService } = setup();

        await expect(service.subscribe(customer, id, [])).resolves.toMatchObject({
          ok: false,
          error: { code: 'VALIDATION_FAILED' },
        });
        expect(ordersService.findOne).not.toHaveBeenCalled();
      },
    );

    it('đã đủ số đơn tối đa → TOO_MANY_SUBSCRIPTIONS; subscribe lại đơn đang theo dõi vẫn được', async () => {
      const { service } = setup(2);
      const full = [OTHER_ID, ORDER_ID];

      await expect(
        service.subscribe(customer, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', full),
      ).resolves.toMatchObject({ ok: false, error: { code: 'TOO_MANY_SUBSCRIPTIONS' } });
      await expect(service.subscribe(customer, ORDER_ID, full)).resolves.toMatchObject({
        ok: true,
      });
    });

    it('lỗi bất ngờ (DB) → INTERNAL_ERROR, không lộ chi tiết', async () => {
      const { service, ordersService } = setup();
      ordersService.findOne.mockRejectedValue(new Error('connection refused 10.0.0.5'));
      const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const ack = await service.subscribe(customer, ORDER_ID, []);

      expect(ack).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
      expect(JSON.stringify(ack)).not.toContain('10.0.0.5');
      expect(logError).toHaveBeenCalled();
      logError.mockRestore();
    });
  });
});

describe('realtime events', () => {
  const event = new OrderStatusChangedEvent(
    ORDER_ID,
    'SF-000001',
    customer.id,
    OrderStatus.PENDING_PAYMENT,
    OrderStatus.PAID,
    { id: 'wh-1', role: Role.WAREHOUSE },
    'ghi chú nội bộ',
    new Date('2026-10-30T01:02:03.000Z'),
  );

  it('payload order:updated không mang note/changedBy', () => {
    expect(toOrderUpdatedPayload(event)).toEqual({
      orderId: ORDER_ID,
      code: 'SF-000001',
      from: OrderStatus.PENDING_PAYMENT,
      to: OrderStatus.PAID,
      occurredAt: '2026-10-30T01:02:03.000Z',
    });
  });

  it('subscribedOrderIds chỉ lấy room order:*', () => {
    expect(subscribedOrderIds(['socket-id', orderRoom(ORDER_ID), 'other'])).toEqual([ORDER_ID]);
  });

  it('listener emit đúng đơn; gateway lỗi thì chỉ log', () => {
    const gateway = { emitOrderUpdated: jest.fn() };
    const listener = new OrderRealtimeListener(gateway as unknown as OrdersGateway);

    listener.handleStatusChanged(event);
    expect(gateway.emitOrderUpdated).toHaveBeenCalledWith(toOrderUpdatedPayload(event));

    gateway.emitOrderUpdated.mockImplementation(() => {
      throw new Error('adapter down');
    });
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    expect(() => listener.handleStatusChanged(event)).not.toThrow();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('adapter down'));
    logError.mockRestore();
  });
});
