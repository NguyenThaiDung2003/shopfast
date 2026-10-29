import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStatus, Role } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { CartRepository } from '../cart/cart.repository';
import { PRODUCT_UPDATED } from '../catalog/events/product-updated.event';
import { ORDER_CREATED, OrderCreatedEvent } from './events/order-created.event';
import { IdempotencyKeyPipe } from './idempotency-key.pipe';
import { OrderRecord, OrdersRepository } from './orders.repository';
import { formatShortages, OrdersService } from './orders.service';
import { ListOrdersQuery } from './dto/list-orders.query';

const customer: AuthUser = { id: 'cust-1', role: Role.CUSTOMER };
const KEY = 'key-12345678';

const order: OrderRecord = {
  id: '0b1f3c1e-1111-4111-8111-111111111111',
  code: 'SF-000051',
  userId: customer.id,
  status: OrderStatus.PENDING_PAYMENT,
  totalAmount: 450_000,
  paidAt: null,
  createdAt: new Date('2026-10-29T10:00:00Z'),
  items: [
    { productId: 1, quantity: 2, unitPrice: 200_000, product: { sku: 'A', name: 'Chuột' } },
    { productId: 2, quantity: 1, unitPrice: 50_000, product: { sku: 'B', name: 'Cáp' } },
  ],
};

describe('OrdersService', () => {
  let orders: jest.Mocked<
    Pick<
      OrdersRepository,
      'createFromCart' | 'findByIdempotencyKey' | 'findById' | 'findPageByUser'
    >
  >;
  let cart: jest.Mocked<Pick<CartRepository, 'findCheckoutLines'>>;
  let emitter: { emit: jest.Mock };
  let service: OrdersService;

  beforeEach(() => {
    orders = {
      createFromCart: jest.fn().mockResolvedValue({
        status: 'created',
        order,
        stockAfter: new Map([
          [1, 8],
          [2, 49],
        ]),
      }),
      findByIdempotencyKey: jest.fn().mockResolvedValue(null),
      findById: jest.fn(),
      findPageByUser: jest.fn(),
    };
    cart = {
      findCheckoutLines: jest.fn().mockResolvedValue([
        { productId: 1, quantity: 2 },
        { productId: 2, quantity: 1 },
      ]),
    };
    emitter = { emit: jest.fn() };
    service = new OrdersService(
      orders as unknown as OrdersRepository,
      cart as unknown as CartRepository,
      emitter as unknown as EventEmitter2,
    );
  });

  describe('create', () => {
    it('tạo đơn từ giỏ, trả thành tiền từng dòng', async () => {
      const { order: view, replayed } = await service.create(customer, KEY);

      expect(orders.createFromCart).toHaveBeenCalledWith(
        customer.id,
        [
          { productId: 1, quantity: 2 },
          { productId: 2, quantity: 1 },
        ],
        KEY,
      );
      expect(replayed).toBe(false);
      expect(view.items[0]).toEqual({
        productId: 1,
        sku: 'A',
        name: 'Chuột',
        quantity: 2,
        unitPrice: 200_000,
        lineTotal: 400_000,
      });
    });

    it('phát order.created và product.updated (tồn trước/sau) cho từng sản phẩm', async () => {
      await service.create(customer);

      const [name, event] = emitter.emit.mock.calls[0]!;
      expect(name).toBe(ORDER_CREATED);
      expect(event).toBeInstanceOf(OrderCreatedEvent);
      expect(event).toMatchObject({
        orderId: order.id,
        code: 'SF-000051',
        totalAmount: 450_000,
        items: [
          { productId: 1, quantity: 2, unitPrice: 200_000 },
          { productId: 2, quantity: 1, unitPrice: 50_000 },
        ],
      });
      const stockEvents = emitter.emit.mock.calls.filter(([n]) => n === PRODUCT_UPDATED);
      expect(stockEvents.map(([, e]) => e.changes)).toEqual([
        { stock: { from: 10, to: 8 } },
        { stock: { from: 50, to: 49 } },
      ]);
    });

    it('key đã có đơn → trả lại đơn đó, không đọc giỏ, không trừ kho, không phát event', async () => {
      orders.findByIdempotencyKey.mockResolvedValue(order);

      const result = await service.create(customer, KEY);

      expect(result.replayed).toBe(true);
      expect(result.order.id).toBe(order.id);
      expect(cart.findCheckoutLines).not.toHaveBeenCalled();
      expect(orders.createFromCart).not.toHaveBeenCalled();
      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it('giỏ rỗng → CART_EMPTY', async () => {
      cart.findCheckoutLines.mockResolvedValue([]);

      await expect(service.create(customer)).rejects.toMatchObject({ code: 'CART_EMPTY' });
    });

    it('giỏ rỗng vì request cùng key vừa commit → trả đơn đó thay vì CART_EMPTY', async () => {
      cart.findCheckoutLines.mockResolvedValue([]);
      orders.findByIdempotencyKey.mockResolvedValueOnce(null).mockResolvedValueOnce(order);

      const result = await service.create(customer, KEY);

      expect(result).toMatchObject({ replayed: true, order: { id: order.id } });
    });

    it('thiếu hàng → 409 OUT_OF_STOCK liệt kê mọi sản phẩm thiếu, không phát event', async () => {
      const shortages = [
        { productId: 1, sku: 'A', name: 'Chuột', requested: 2, available: 1 },
        { productId: 2, sku: 'B', name: 'Cáp', requested: 1, available: 0 },
      ];
      orders.createFromCart.mockResolvedValue({ status: 'insufficient_stock', shortages });

      await expect(service.create(customer)).rejects.toMatchObject({
        code: 'OUT_OF_STOCK',
        userMessage:
          'Không đủ hàng: "Chuột" (A) còn 1, bạn đặt 2; "Cáp" (B) đã hết hàng, bạn đặt 1. Vui lòng cập nhật giỏ hàng.',
        details: shortages,
      });
      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it('trùng key khi đang tạo đồng thời → trả đơn đã tạo', async () => {
      orders.createFromCart.mockResolvedValue({ status: 'duplicate' });
      orders.findByIdempotencyKey.mockResolvedValueOnce(null).mockResolvedValueOnce(order);

      const result = await service.create(customer, KEY);

      expect(result).toMatchObject({ replayed: true, order: { id: order.id } });
      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it('trùng key nhưng chưa đọc được đơn → 409 IDEMPOTENCY_CONFLICT', async () => {
      orders.createFromCart.mockResolvedValue({ status: 'duplicate' });

      await expect(service.create(customer, KEY)).rejects.toMatchObject({
        code: 'IDEMPOTENCY_CONFLICT',
      });
    });

    it('quá tải (P2028) → 503 ORDER_BUSY', async () => {
      orders.createFromCart.mockResolvedValue({ status: 'busy' });

      await expect(service.create(customer)).rejects.toMatchObject({
        code: 'ORDER_BUSY',
        status: 503,
      });
    });

    it('tổng tiền tràn INTEGER → 400 ORDER_TOO_LARGE', async () => {
      orders.createFromCart.mockResolvedValue({ status: 'total_overflow' });

      await expect(service.create(customer)).rejects.toMatchObject({ code: 'ORDER_TOO_LARGE' });
    });
  });

  describe('findOne / listMine', () => {
    it('chủ đơn xem được', async () => {
      orders.findById.mockResolvedValue(order);

      await expect(service.findOne(customer, order.id)).resolves.toMatchObject({ id: order.id });
    });

    it('nhân viên xem được đơn của khách', async () => {
      orders.findById.mockResolvedValue(order);

      await expect(
        service.findOne({ id: 'sup-1', role: Role.SUPPORT }, order.id),
      ).resolves.toBeDefined();
    });

    it('customer khác → 404 (không lộ đơn tồn tại)', async () => {
      orders.findById.mockResolvedValue(order);

      await expect(
        service.findOne({ id: 'cust-2', role: Role.CUSTOMER }, order.id),
      ).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND', status: 404 });
    });

    it('không tồn tại → 404', async () => {
      orders.findById.mockResolvedValue(null);

      await expect(service.findOne(customer, order.id)).rejects.toMatchObject({
        code: 'ORDER_NOT_FOUND',
      });
    });

    it('lịch sử đơn phân trang', async () => {
      orders.findPageByUser.mockResolvedValue({ items: [order], total: 11 });

      const page = await service.listMine(
        customer,
        Object.assign(new ListOrdersQuery(), { page: 2, limit: 10 }),
      );

      expect(orders.findPageByUser).toHaveBeenCalledWith(customer.id, 10, 10);
      expect(page.meta).toEqual({ page: 2, limit: 10, total: 11, totalPages: 2 });
    });
  });

  it('formatShortages: sản phẩm không còn trong DB vẫn có nhãn', () => {
    expect(
      formatShortages([{ productId: 9, sku: '', name: '#9', requested: 1, available: 0 }]),
    ).toBe('Không đủ hàng: "#9" đã hết hàng, bạn đặt 1. Vui lòng cập nhật giỏ hàng.');
  });
});

describe('IdempotencyKeyPipe', () => {
  const pipe = new IdempotencyKeyPipe();

  it('không gửi header → undefined', () => {
    expect(pipe.transform(undefined)).toBeUndefined();
  });

  it('chấp nhận UUID', () => {
    expect(pipe.transform('3f2b8c1e-9d4a-4b7e-8f21-0c6d5e4a3b21')).toBe(
      '3f2b8c1e-9d4a-4b7e-8f21-0c6d5e4a3b21',
    );
  });

  it.each(['short', 'có dấu-12345', 'a'.repeat(101), ''])('từ chối "%s"', (value) => {
    expect(() => pipe.transform(value)).toThrow(
      expect.objectContaining({ code: 'INVALID_IDEMPOTENCY_KEY' }),
    );
  });
});
