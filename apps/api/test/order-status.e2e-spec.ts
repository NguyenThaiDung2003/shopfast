import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStatus, Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import {
  ORDER_STATUS_CHANGED,
  OrderStatusChangedEvent,
} from '../src/modules/orders/events/order-status-changed.event';
import { createTestApp } from './create-test-app';

const PASSWORD = 'MatKhau123';
const { PENDING_PAYMENT, PAID, PROCESSING, SHIPPING, DELIVERED, CANCELLED } = OrderStatus;

describe('Order status state machine (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const events: OrderStatusChangedEvent[] = [];
  const tokens = { customer: '', other: '', warehouse: '', admin: '', support: '' };
  const ids = { customer: '', warehouse: '' };
  let productId = 0;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const setStatus = (
    orderId: string,
    status: OrderStatus,
    token = tokens.warehouse,
    note?: string,
  ) => http.patch(`/api/orders/${orderId}/status`).set(auth(token)).send({ status, note });
  const stock = async () =>
    (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stock;

  /** Customer đặt một đơn 2 sản phẩm qua API (đi đúng luồng thật, có lịch sử lúc tạo). */
  async function placeOrder(): Promise<string> {
    await http
      .post('/api/cart/items')
      .set(auth(tokens.customer))
      .send({ productId, quantity: 2 })
      .expect(201);
    const { body } = await http.post('/api/orders').set(auth(tokens.customer)).expect(201);
    return body.id;
  }

  async function login(email: string, role: Role, passwordHash: string): Promise<[string, string]> {
    const user = await prisma.user.create({
      data: { email, role, passwordHash, fullName: `E2E ${role}` },
    });
    const res = await http.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return [user.id, res.body.accessToken];
  }

  beforeAll(async () => {
    ({ app } = await createTestApp());
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    app.get(EventEmitter2).on(ORDER_STATUS_CHANGED, (e: OrderStatusChangedEvent) => events.push(e));

    const category = await prisma.category.create({
      data: { name: 'E2E Status', slug: 'e2e-status' },
    });
    const brand = await prisma.brand.create({ data: { name: 'E2E Status', slug: 'e2e-status' } });
    productId = (
      await prisma.product.create({
        data: {
          sku: 'STS-001',
          name: 'Ổ cứng E2E',
          slug: 'o-cung-e2e',
          price: 1_500_000,
          stock: 100,
          categoryId: category.id,
          brandId: brand.id,
        },
      })
    ).id;

    const passwordHash = await hash(PASSWORD, 4);
    [ids.customer, tokens.customer] = await login(
      'cus.status.e2e@shopfast.local',
      Role.CUSTOMER,
      passwordHash,
    );
    [, tokens.other] = await login('other.status.e2e@shopfast.local', Role.CUSTOMER, passwordHash);
    [ids.warehouse, tokens.warehouse] = await login(
      'wh.status.e2e@shopfast.local',
      Role.WAREHOUSE,
      passwordHash,
    );
    [, tokens.admin] = await login('admin.status.e2e@shopfast.local', Role.ADMIN, passwordHash);
    [, tokens.support] = await login('sup.status.e2e@shopfast.local', Role.SUPPORT, passwordHash);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    events.length = 0;
  });

  it('vòng đời đầy đủ PENDING_PAYMENT → PAID → PROCESSING → SHIPPING → DELIVERED', async () => {
    const orderId = await placeOrder();

    const paid = await setStatus(orderId, PAID, tokens.admin, 'Đã nhận chuyển khoản').expect(200);
    expect(paid.body.status).toBe(PAID);
    expect(paid.body.paidAt).toEqual(expect.any(String));

    await setStatus(orderId, PROCESSING).expect(200);
    await setStatus(orderId, SHIPPING, tokens.warehouse, 'GHN-123456').expect(200);
    const delivered = await setStatus(orderId, DELIVERED).expect(200);

    expect(delivered.body.status).toBe(DELIVERED);
    // Lịch sử: ai đổi, đổi từ đâu sang đâu, lúc nào – theo đúng thứ tự.
    const history = delivered.body.statusHistory as Array<{
      from: OrderStatus | null;
      to: OrderStatus;
      note: string | null;
      changedAt: string;
      changedBy: { id?: string; role: Role };
    }>;
    expect(history.map((h) => [h.from, h.to])).toEqual([
      [null, PENDING_PAYMENT],
      [PENDING_PAYMENT, PAID],
      [PAID, PROCESSING],
      [PROCESSING, SHIPPING],
      [SHIPPING, DELIVERED],
    ]);
    expect(history.map((h) => h.changedBy.role)).toEqual([
      Role.CUSTOMER,
      Role.ADMIN,
      Role.WAREHOUSE,
      Role.WAREHOUSE,
      Role.WAREHOUSE,
    ]);
    expect(history[3]).toMatchObject({ note: 'GHN-123456', changedBy: { id: ids.warehouse } });
    const times = history.map((h) => Date.parse(h.changedAt));
    expect([...times].sort((a, b) => a - b)).toEqual(times);

    expect(events.map((e) => [e.from, e.to])).toEqual([
      [PENDING_PAYMENT, PAID],
      [PAID, PROCESSING],
      [PROCESSING, SHIPPING],
      [SHIPPING, DELIVERED],
    ]);
    expect(events[0]).toMatchObject({
      orderId,
      userId: ids.customer,
      changedBy: { role: Role.ADMIN },
      note: 'Đã nhận chuyển khoản',
    });
  });

  it('409: nhảy cóc, lùi trạng thái, đứng yên, đi tiếp từ trạng thái cuối', async () => {
    const orderId = await placeOrder();

    const skip = await setStatus(orderId, SHIPPING).expect(409);
    expect(skip.body).toMatchObject({
      code: 'INVALID_STATUS_TRANSITION',
      message:
        'Không thể chuyển đơn từ "Chờ thanh toán" sang "Đang giao". Có thể chuyển sang: "Đã thanh toán", "Đã huỷ".',
      details: { from: PENDING_PAYMENT, to: SHIPPING, allowed: [PAID, CANCELLED] },
    });
    await setStatus(orderId, PENDING_PAYMENT).expect(409);

    await setStatus(orderId, PAID).expect(200);
    await setStatus(orderId, PENDING_PAYMENT).expect(409);

    await setStatus(orderId, CANCELLED).expect(200);
    await setStatus(orderId, PAID).expect(409);

    // Các lần chuyển sai không để lại dấu vết.
    const { body } = await http
      .get(`/api/orders/${orderId}`)
      .set(auth(tokens.warehouse))
      .expect(200);
    expect(body.statusHistory).toHaveLength(3);
  });

  it('409: đang giao thì không huỷ được', async () => {
    const orderId = await placeOrder();
    for (const status of [PAID, PROCESSING, SHIPPING]) await setStatus(orderId, status).expect(200);

    const { body } = await setStatus(orderId, CANCELLED).expect(409);

    expect(body.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('huỷ đơn PROCESSING → hoàn lại tồn kho', async () => {
    const orderId = await placeOrder();
    const afterOrder = await stock();
    await setStatus(orderId, PAID).expect(200);
    await setStatus(orderId, PROCESSING).expect(200);

    await setStatus(orderId, CANCELLED, tokens.warehouse, 'Khách đổi ý').expect(200);

    expect(await stock()).toBe(afterOrder + 2);
  });

  it('2 nhân viên cùng chuyển PAID → PROCESSING đồng thời → đúng một người thành công', async () => {
    const orderId = await placeOrder();
    await setStatus(orderId, PAID).expect(200);
    events.length = 0;

    const results = await Promise.all([
      setStatus(orderId, PROCESSING, tokens.warehouse),
      setStatus(orderId, PROCESSING, tokens.admin),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(['STATUS_CHANGED_CONCURRENTLY', 'INVALID_STATUS_TRANSITION']).toContain(loser.body.code);
    expect(
      await prisma.orderStatusHistory.count({ where: { orderId, toStatus: PROCESSING } }),
    ).toBe(1);
    expect(events).toHaveLength(1);
  });

  it('huỷ đồng thời 5 lần → chỉ hoàn kho một lần', async () => {
    const orderId = await placeOrder();
    const afterOrder = await stock();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => setStatus(orderId, CANCELLED)),
    );

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await stock()).toBe(afterOrder + 2);
  });

  it('403: customer và support không đổi được trạng thái; 401 khi chưa đăng nhập', async () => {
    const orderId = await placeOrder();

    await setStatus(orderId, PAID, tokens.customer).expect(403);
    await setStatus(orderId, PAID, tokens.support).expect(403);
    await http.patch(`/api/orders/${orderId}/status`).send({ status: PAID }).expect(401);
  });

  it('400: trạng thái không tồn tại / ghi chú quá dài; 404: đơn không tồn tại', async () => {
    const orderId = await placeOrder();

    await setStatus(orderId, 'SHIPPED' as OrderStatus).expect(400);
    await setStatus(orderId, PAID, tokens.warehouse, 'x'.repeat(501)).expect(400);
    await setStatus('7a4f3d2e-0000-4000-8000-000000000000', PAID).expect(404);
  });

  it('chủ đơn xem lịch sử nhưng không thấy id/tên nhân viên', async () => {
    const orderId = await placeOrder();
    await setStatus(orderId, PAID).expect(200);

    const { body } = await http
      .get(`/api/orders/${orderId}`)
      .set(auth(tokens.customer))
      .expect(200);

    expect(body.statusHistory[1]).toMatchObject({
      from: PENDING_PAYMENT,
      to: PAID,
      changedBy: { role: Role.WAREHOUSE },
    });
    expect(body.statusHistory[1].changedBy).not.toHaveProperty('id');
    expect(body.statusHistory[1].changedBy).not.toHaveProperty('fullName');
  });

  describe('GET /orders/me', () => {
    it('chỉ trả đơn của chính mình, mới nhất trước, có phân trang', async () => {
      const { body } = await http
        .get('/api/orders/me?limit=2')
        .set(auth(tokens.customer))
        .expect(200);

      expect(body.items).toHaveLength(2);
      expect(body.meta).toMatchObject({ page: 1, limit: 2 });
      expect(body.meta.total).toBeGreaterThanOrEqual(8);
      const [a, b] = body.items;
      expect(Date.parse(a.createdAt)).toBeGreaterThanOrEqual(Date.parse(b.createdAt));

      const other = await http.get('/api/orders/me').set(auth(tokens.other)).expect(200);
      expect(other.body.meta.total).toBe(0);
    });

    it('400: limit vượt 50; 403: nhân viên', async () => {
      await http.get('/api/orders/me?limit=51').set(auth(tokens.customer)).expect(400);
      await http.get('/api/orders/me').set(auth(tokens.warehouse)).expect(403);
    });

    it('customer khác xem đơn → 404', async () => {
      const orderId = await placeOrder();

      await http.get(`/api/orders/${orderId}`).set(auth(tokens.other)).expect(404);
    });
  });
});
