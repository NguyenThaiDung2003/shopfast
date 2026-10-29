import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import {
  PRODUCT_UPDATED,
  ProductUpdatedEvent,
} from '../src/modules/catalog/events/product-updated.event';
import { ORDER_CREATED, OrderCreatedEvent } from '../src/modules/orders/events/order-created.event';
import { createTestApp } from './create-test-app';

const PASSWORD = 'MatKhau123';
const BUYERS = 20;
const HOT_STOCK = 5;

describe('Cart & Orders (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const orderEvents: OrderCreatedEvent[] = [];
  const productEvents: ProductUpdatedEvent[] = [];

  const product = { hot: 0, a: 0, b: 0, c: 0 };
  const users: Record<'alice' | 'bob' | 'support' | 'warehouse', { id: string; token: string }> =
    {} as never;
  const buyers: Array<{ id: string; token: string }> = [];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const stockOf = async (id: number) =>
    (await prisma.product.findUniqueOrThrow({ where: { id } })).stock;
  const placeOrder = (token: string, key?: string) => {
    const req = http.post('/api/orders').set(auth(token));
    return key ? req.set('Idempotency-Key', key) : req;
  };

  async function createUser(email: string, role: Role, passwordHash: string) {
    const { id } = await prisma.user.create({
      data: { email, role, passwordHash, fullName: `E2E ${email}` },
    });
    const res = await http.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return { id, token: res.body.accessToken as string };
  }

  beforeAll(async () => {
    ({ app } = await createTestApp());
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    const emitter = app.get(EventEmitter2);
    emitter.on(ORDER_CREATED, (e: OrderCreatedEvent) => orderEvents.push(e));
    emitter.on(PRODUCT_UPDATED, (e: ProductUpdatedEvent) => productEvents.push(e));

    const category = await prisma.category.create({
      data: { name: 'E2E Orders', slug: 'e2e-orders' },
    });
    const brand = await prisma.brand.create({ data: { name: 'E2E Orders', slug: 'e2e-orders' } });
    const make = (sku: string, name: string, price: number, stock: number) =>
      prisma.product.create({
        data: {
          sku,
          name,
          slug: sku.toLowerCase(),
          price,
          stock,
          categoryId: category.id,
          brandId: brand.id,
        },
      });
    product.hot = (await make('ORD-HOT', 'Tai nghe Flash Sale', 1_000_000, HOT_STOCK)).id;
    product.a = (await make('ORD-A', 'Chuột không dây E2E', 200_000, 10)).id;
    product.b = (await make('ORD-B', 'Bàn phím E2E', 300_000, 1)).id;
    product.c = (await make('ORD-C', 'Cáp USB-C E2E', 50_000, 50)).id;

    const passwordHash = await hash(PASSWORD, 4);
    users.alice = await createUser('alice.orders.e2e@shopfast.local', Role.CUSTOMER, passwordHash);
    users.bob = await createUser('bob.orders.e2e@shopfast.local', Role.CUSTOMER, passwordHash);
    users.support = await createUser(
      'support.orders.e2e@shopfast.local',
      Role.SUPPORT,
      passwordHash,
    );
    users.warehouse = await createUser(
      'warehouse.orders.e2e@shopfast.local',
      Role.WAREHOUSE,
      passwordHash,
    );
    for (let i = 1; i <= BUYERS; i++) {
      const email = `buyer${String(i).padStart(2, '0')}.orders.e2e@shopfast.local`;
      buyers.push(await createUser(email, Role.CUSTOMER, passwordHash));
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    orderEvents.length = 0;
    productEvents.length = 0;
  });

  describe('giỏ hàng', () => {
    const cart = () => http.get('/api/cart').set(auth(users.alice.token));
    const add = (productId: number, quantity: number) =>
      http.post('/api/cart/items').set(auth(users.alice.token)).send({ productId, quantity });

    it('thêm, cộng dồn, sửa số lượng, xoá', async () => {
      await add(product.a, 2).expect(201);
      const added = await add(product.a, 1).expect(201);
      expect(added.body.items).toEqual([
        expect.objectContaining({ productId: product.a, quantity: 3, lineTotal: 600_000 }),
      ]);

      const updated = await http
        .patch(`/api/cart/items/${product.a}`)
        .set(auth(users.alice.token))
        .send({ quantity: 5 })
        .expect(200);
      expect(updated.body).toMatchObject({ totalQuantity: 5, subtotal: 1_000_000 });

      await http.delete(`/api/cart/items/${product.a}`).set(auth(users.alice.token)).expect(204);
      expect((await cart().expect(200)).body).toEqual({ items: [], totalQuantity: 0, subtotal: 0 });
    });

    it('409: thêm vượt tồn kho, thông điệp nêu tên sản phẩm', async () => {
      const { body } = await add(product.b, 2).expect(409);

      expect(body).toMatchObject({
        code: 'INSUFFICIENT_STOCK',
        message: 'Sản phẩm "Bàn phím E2E" chỉ còn 1, không đủ 2.',
      });
    });

    it('404: sản phẩm không tồn tại / dòng không có trong giỏ', async () => {
      await add(2_000_000_000, 1).expect(404);
      const { body } = await http
        .patch(`/api/cart/items/${product.c}`)
        .set(auth(users.alice.token))
        .send({ quantity: 1 })
        .expect(404);
      expect(body.code).toBe('CART_ITEM_NOT_FOUND');
    });

    it('400: số lượng ngoài 1..99', async () => {
      await add(product.a, 0).expect(400);
      await add(product.a, 100).expect(400);
    });

    it('403: nhân viên không có giỏ hàng', async () => {
      await http.get('/api/cart').set(auth(users.support.token)).expect(403);
    });

    it('400 CART_EMPTY: đặt hàng khi giỏ trống', async () => {
      const { body } = await placeOrder(users.alice.token).expect(400);

      expect(body.code).toBe('CART_EMPTY');
    });
  });

  describe('đặt hàng đồng thời (bắt buộc)', () => {
    it(`${BUYERS} người cùng mua 1 sản phẩm còn ${HOT_STOCK} cái → đúng ${HOT_STOCK} đơn, tồn kho = 0`, async () => {
      await prisma.cartItem.createMany({
        data: buyers.map((b) => ({ userId: b.id, productId: product.hot, quantity: 1 })),
      });

      const responses = await Promise.all(buyers.map((b) => placeOrder(b.token)));

      const created = responses.filter((r) => r.status === 201);
      const rejected = responses.filter((r) => r.status === 409);
      // Không có 500/503 nào: mọi request đều được trả lời đúng nghiệp vụ.
      expect(created).toHaveLength(HOT_STOCK);
      expect(rejected).toHaveLength(BUYERS - HOT_STOCK);
      for (const r of rejected) {
        expect(r.body.code).toBe('OUT_OF_STOCK');
        expect(r.body.message).toContain('"Tai nghe Flash Sale" (ORD-HOT) đã hết hàng, bạn đặt 1');
      }

      expect(await stockOf(product.hot)).toBe(0);
      const sold = await prisma.orderItem.aggregate({
        where: { productId: product.hot },
        _sum: { quantity: true },
        _count: true,
      });
      expect(sold._sum.quantity).toBe(HOT_STOCK);
      expect(sold._count).toBe(HOT_STOCK);
      expect(new Set(created.map((r) => r.body.code)).size).toBe(HOT_STOCK);

      // Người thất bại: transaction đã rollback nên giỏ còn nguyên; người mua được: giỏ đã xoá.
      expect(await prisma.cartItem.count({ where: { productId: product.hot } })).toBe(
        BUYERS - HOT_STOCK,
      );
      expect(orderEvents).toHaveLength(HOT_STOCK);
      expect(await prisma.product.count({ where: { stock: { lt: 0 } } })).toBe(0);
    });
  });

  describe('đặt hàng', () => {
    it('một sản phẩm thiếu → 409 nêu đúng sản phẩm, rollback toàn bộ (không trừ sản phẩm khác)', async () => {
      await prisma.cartItem.createMany({
        data: [
          { userId: users.alice.id, productId: product.a, quantity: 2 },
          { userId: users.alice.id, productId: product.b, quantity: 1 },
        ],
      });
      await prisma.product.update({ where: { id: product.b }, data: { stock: 0 } }); // vừa có người mua hết
      const ordersBefore = await prisma.order.count({ where: { userId: users.alice.id } });

      const { body } = await placeOrder(users.alice.token).expect(409);

      expect(body.code).toBe('OUT_OF_STOCK');
      expect(body.message).toBe(
        'Không đủ hàng: "Bàn phím E2E" (ORD-B) đã hết hàng, bạn đặt 1. Vui lòng cập nhật giỏ hàng.',
      );
      expect(body.details).toEqual([
        { productId: product.b, sku: 'ORD-B', name: 'Bàn phím E2E', requested: 1, available: 0 },
      ]);
      expect(await stockOf(product.a)).toBe(10);
      expect(await prisma.order.count({ where: { userId: users.alice.id } })).toBe(ordersBefore);
      expect(await prisma.cartItem.count({ where: { userId: users.alice.id } })).toBe(2);
      expect(orderEvents).toHaveLength(0);
    });

    it('201: tạo đơn, chụp giá lúc đặt, xoá giỏ, phát order.created + product.updated', async () => {
      await http.delete(`/api/cart/items/${product.b}`).set(auth(users.alice.token)).expect(204);

      const { body } = await placeOrder(users.alice.token).expect(201);

      expect(body).toMatchObject({
        code: expect.stringMatching(/^SF-\d{6}$/),
        status: 'PENDING_PAYMENT',
        totalAmount: 400_000,
        items: [
          {
            productId: product.a,
            sku: 'ORD-A',
            quantity: 2,
            unitPrice: 200_000,
            lineTotal: 400_000,
          },
        ],
      });
      expect(body).not.toHaveProperty('idempotencyKey');
      expect(await stockOf(product.a)).toBe(8);
      expect(await prisma.cartItem.count({ where: { userId: users.alice.id } })).toBe(0);

      expect(orderEvents).toHaveLength(1);
      expect(orderEvents[0]).toMatchObject({
        orderId: body.id,
        code: body.code,
        userId: users.alice.id,
        totalAmount: 400_000,
        items: [{ productId: product.a, quantity: 2, unitPrice: 200_000 }],
      });
      expect(productEvents).toEqual([
        expect.objectContaining({ productId: product.a, changes: { stock: { from: 10, to: 8 } } }),
      ]);

      // Đổi giá sau khi đặt không làm đổi đơn đã đặt.
      await prisma.product.update({ where: { id: product.a }, data: { price: 999_000 } });
      const order = await http
        .get(`/api/orders/${body.id}`)
        .set(auth(users.alice.token))
        .expect(200);
      expect(order.body.items[0].unitPrice).toBe(200_000);
    });

    it('403: nhân viên không đặt hàng', async () => {
      await placeOrder(users.warehouse.token).expect(403);
    });
  });

  describe('Idempotency-Key', () => {
    it('gửi lại cùng key → 200, cùng đơn, header replay, kho chỉ trừ một lần', async () => {
      await prisma.cartItem.create({
        data: { userId: users.alice.id, productId: product.c, quantity: 1 },
      });
      const key = randomUUID();

      const first = await placeOrder(users.alice.token, key).expect(201);
      const second = await placeOrder(users.alice.token, key).expect(200);

      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(first.headers['idempotent-replayed']).toBeUndefined();
      expect(second.body.id).toBe(first.body.id);
      expect(await stockOf(product.c)).toBe(49);
      expect(orderEvents).toHaveLength(1);
    });

    it('5 request cùng key gửi đồng thời (bấm liên tục) → đúng 1 đơn', async () => {
      await prisma.cartItem.create({
        data: { userId: users.alice.id, productId: product.c, quantity: 2 },
      });
      const key = randomUUID();

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => placeOrder(users.alice.token, key)),
      );

      const statuses = responses.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 200, 200, 200, 201]);
      expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
      expect(await prisma.order.count({ where: { idempotencyKey: key } })).toBe(1);
      expect(await stockOf(product.c)).toBe(47);
      expect(orderEvents).toHaveLength(1);
    });

    it('cùng key ở hai user khác nhau → hai đơn riêng (key tính theo từng user)', async () => {
      const key = randomUUID();
      await prisma.cartItem.create({
        data: { userId: users.bob.id, productId: product.c, quantity: 1 },
      });
      await prisma.cartItem.create({
        data: { userId: users.alice.id, productId: product.c, quantity: 1 },
      });

      const alice = await placeOrder(users.alice.token, key).expect(201);
      const bob = await placeOrder(users.bob.token, key).expect(201);

      expect(bob.body.id).not.toBe(alice.body.id);
    });

    it('400: key sai định dạng', async () => {
      const { body } = await placeOrder(users.alice.token, 'abc').expect(400);

      expect(body.code).toBe('INVALID_IDEMPOTENCY_KEY');
    });
  });

  describe('xem đơn', () => {
    let orderId: string;

    beforeAll(async () => {
      const { body } = await http.get('/api/orders').set(auth(users.alice.token)).expect(200);
      orderId = body.items[0].id;
      expect(body.meta.total).toBeGreaterThanOrEqual(3);
    });

    it('chủ đơn và nhân viên xem được; customer khác nhận 404', async () => {
      await http.get(`/api/orders/${orderId}`).set(auth(users.alice.token)).expect(200);
      await http.get(`/api/orders/${orderId}`).set(auth(users.support.token)).expect(200);
      const { body } = await http
        .get(`/api/orders/${orderId}`)
        .set(auth(users.bob.token))
        .expect(404);
      expect(body.code).toBe('ORDER_NOT_FOUND');
    });

    it('400: id không phải UUID', async () => {
      await http.get('/api/orders/123').set(auth(users.alice.token)).expect(400);
    });
  });
});
