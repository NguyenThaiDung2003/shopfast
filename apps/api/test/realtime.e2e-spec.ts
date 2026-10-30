import './realtime.env';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { OrderStatus, Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import { OrderSnapshot, OrderSocketClient, OrderUpdate } from '../../web/src/realtime/order-socket';
import { createTestApp } from './create-test-app';

const PASSWORD = 'MatKhau123';
const LATENCY_BUDGET_MS = 1_000;
const { PENDING_PAYMENT, PAID, PROCESSING, SHIPPING, DELIVERED } = OrderStatus;

interface Session {
  id: string;
  token: string;
}

const portOf = (app: INestApplication) => (app.getHttpServer().address() as AddressInfo).port;

/** Kết nối thô bằng socket.io-client (không tự nối lại) – resolve khi vào được, reject khi bị từ chối. */
function connect(
  port: number,
  auth: { token?: string } = {},
  extraHeaders?: Record<string, string>,
): Promise<ClientSocket> {
  const socket = io(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    auth,
    extraHeaders,
  });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error) => {
      socket.close();
      reject(error);
    });
  });
}

function nextEvent<T>(socket: ClientSocket, event: string, timeoutMs = 3_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Không nhận "${event}"`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Chờ tới khi `predicate` đúng (dùng cho client mẫu chạy bất đồng bộ). */
async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Hết thời gian chờ điều kiện');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Realtime theo dõi đơn – Socket.IO (e2e)', () => {
  let app: INestApplication;
  /** Instance thứ hai cùng DB + Redis, mô phỏng blue-green. */
  let app2: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let port = 0;
  let port2 = 0;
  let productId = 0;
  const users: Record<'a' | 'b' | 'warehouse', Session> = {
    a: { id: '', token: '' },
    b: { id: '', token: '' },
    warehouse: { id: '', token: '' },
  };
  const opened: ClientSocket[] = [];
  const clients: OrderSocketClient[] = [];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const setStatus = (orderId: string, status: OrderStatus, via = http) =>
    via
      .patch(`/api/orders/${orderId}/status`)
      .set(auth(users.warehouse.token))
      .send({ status })
      .expect(200);

  async function open(token: string, onPort = port): Promise<ClientSocket> {
    const socket = await connect(onPort, { token });
    opened.push(socket);
    return socket;
  }

  async function placeOrder(token: string): Promise<string> {
    await http
      .post('/api/cart/items')
      .set(auth(token))
      .send({ productId, quantity: 1 })
      .expect(201);
    const { body } = await http.post('/api/orders').set(auth(token)).expect(201);
    return body.id;
  }

  async function login(key: keyof typeof users, role: Role, passwordHash: string): Promise<void> {
    const email = `${key}.realtime.e2e@shopfast.local`;
    const user = await prisma.user.create({
      data: { email, role, passwordHash, fullName: `E2E realtime ${key}` },
    });
    const res = await http.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    users[key] = { id: user.id, token: res.body.accessToken };
  }

  beforeAll(async () => {
    ({ app } = await createTestApp());
    // EventEmitterModule.forRoot() tạo EventEmitter2 lúc khai báo AppModule → mọi app trong cùng
    // process dùng chung một emitter. Instance 2 cần emitter riêng như một process thật, để
    // tin tới được nó CHỈ qua Redis adapter.
    ({ app: app2 } = await createTestApp({
      override: (builder) => builder.overrideProvider(EventEmitter2).useValue(new EventEmitter2()),
    }));
    await app.listen(0, '127.0.0.1');
    await app2.listen(0, '127.0.0.1');
    port = portOf(app);
    port2 = portOf(app2);
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    const category = await prisma.category.create({
      data: { name: 'E2E Realtime', slug: 'e2e-realtime' },
    });
    const brand = await prisma.brand.create({
      data: { name: 'E2E Realtime', slug: 'e2e-realtime' },
    });
    productId = (
      await prisma.product.create({
        data: {
          sku: 'RT-001',
          name: 'Tai nghe E2E realtime',
          slug: 'tai-nghe-e2e-realtime',
          price: 500_000,
          stock: 1_000,
          categoryId: category.id,
          brandId: brand.id,
        },
      })
    ).id;

    const passwordHash = await hash(PASSWORD, 4);
    await login('a', Role.CUSTOMER, passwordHash);
    await login('b', Role.CUSTOMER, passwordHash);
    await login('warehouse', Role.WAREHOUSE, passwordHash);
  });

  afterEach(() => {
    opened.splice(0).forEach((socket) => socket.close());
    clients.splice(0).forEach((client) => client.close());
  });

  afterAll(async () => {
    await app2.close();
    await app.close();
  });

  describe('xác thực tại handshake', () => {
    it.each([
      ['không có token', {}, 'UNAUTHENTICATED'],
      ['token rác', { token: 'khong-phai-jwt' }, 'UNAUTHENTICATED'],
    ])('%s → bị từ chối kết nối', async (_name, authData, code) => {
      const error = (await connect(port, authData).catch((e: unknown) => e)) as Error & {
        data?: { code: string; message: string };
      };

      expect(error).toBeInstanceOf(Error);
      expect(error.data).toEqual({ code, message: 'Bạn cần đăng nhập để tiếp tục.' });
    });

    it('token hết hạn → TOKEN_EXPIRED tiếng Việt', async () => {
      const expired = await app
        .get(JwtService)
        .signAsync({ sub: users.a.id, role: Role.CUSTOMER }, { expiresIn: -10 });

      const error = (await connect(port, { token: expired }).catch((e: unknown) => e)) as Error & {
        data?: { code: string; message: string };
      };

      expect(error.data?.code).toBe('TOKEN_EXPIRED');
      expect(error.data?.message).toMatch(/hết hạn/);
    });

    it('nhận token qua header Authorization: Bearer', async () => {
      const socket = await connect(port, {}, auth(users.a.token));
      opened.push(socket);
      expect(socket.connected).toBe(true);
    });
  });

  describe('order:subscribe', () => {
    it('user A không subscribe được đơn của user B, và không nhận cập nhật của đơn đó', async () => {
      const orderB = await placeOrder(users.b.token);
      const socketA = await open(users.a.token);

      const ack = await socketA.emitWithAck('order:subscribe', { orderId: orderB });
      expect(ack).toEqual({
        ok: false,
        error: { code: 'ORDER_NOT_FOUND', message: 'Không tìm thấy đơn hàng.' },
      });

      const received: OrderUpdate[] = [];
      socketA.on('order:updated', (u: OrderUpdate) => received.push(u));
      await setStatus(orderB, PAID);
      await sleep(300);
      expect(received).toEqual([]);
    });

    it('chủ đơn và nhân viên subscribe được; ack mang trạng thái hiện tại', async () => {
      const orderB = await placeOrder(users.b.token);
      const owner = await open(users.b.token);
      const staff = await open(users.warehouse.token);

      for (const socket of [owner, staff]) {
        await expect(socket.emitWithAck('order:subscribe', { orderId: orderB })).resolves.toEqual({
          ok: true,
          order: { id: orderB, code: expect.stringMatching(/^SF-/), status: PENDING_PAYMENT },
        });
      }
    });

    it('orderId sai định dạng → VALIDATION_FAILED; đơn không tồn tại → ORDER_NOT_FOUND', async () => {
      const socket = await open(users.a.token);

      await expect(socket.emitWithAck('order:subscribe', { orderId: '1' })).resolves.toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
      await expect(
        socket.emitWithAck('order:subscribe', { orderId: '00000000-0000-4000-8000-000000000000' }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'ORDER_NOT_FOUND' } });
    });
  });

  describe('order:updated', () => {
    it('đổi trạng thái → chỉ client trong room nhận, payload không lộ ghi chú nội bộ', async () => {
      const orderA = await placeOrder(users.a.token);
      const subscribed = await open(users.a.token);
      const sameUserNotSubscribed = await open(users.a.token);
      const otherUser = await open(users.b.token);
      await subscribed.emitWithAck('order:subscribe', { orderId: orderA });

      const leaked: string[] = [];
      sameUserNotSubscribed.on('order:updated', () => leaked.push('A2'));
      otherUser.on('order:updated', () => leaked.push('B'));

      const update = nextEvent<OrderUpdate>(subscribed, 'order:updated');
      await setStatus(orderA, PAID);

      expect(await update).toEqual({
        orderId: orderA,
        code: expect.stringMatching(/^SF-/),
        from: PENDING_PAYMENT,
        to: PAID,
        occurredAt: expect.any(String),
      });
      await sleep(300);
      expect(leaked).toEqual([]);
    });

    it('order:unsubscribe → không nhận nữa', async () => {
      const orderA = await placeOrder(users.a.token);
      const socket = await open(users.a.token);
      await socket.emitWithAck('order:subscribe', { orderId: orderA });
      await expect(socket.emitWithAck('order:unsubscribe', { orderId: orderA })).resolves.toEqual({
        ok: true,
      });

      const received: OrderUpdate[] = [];
      socket.on('order:updated', (u: OrderUpdate) => received.push(u));
      await setStatus(orderA, PAID);
      await sleep(300);
      expect(received).toEqual([]);
    });

    it(`độ trễ từ lúc đổi trạng thái tới lúc client nhận < ${LATENCY_BUDGET_MS}ms`, async () => {
      const orderA = await placeOrder(users.a.token);
      const socket = await open(users.a.token);
      await socket.emitWithAck('order:subscribe', { orderId: orderA });

      const latencies: number[] = [];
      for (const status of [PAID, PROCESSING, SHIPPING, DELIVERED]) {
        const received = nextEvent<OrderUpdate>(socket, 'order:updated');
        const start = performance.now();
        await setStatus(orderA, status);
        expect((await received).to).toBe(status);
        latencies.push(performance.now() - start);
      }

      console.warn(
        `[realtime] độ trễ PATCH → order:updated (ms): ${latencies.map((l) => l.toFixed(1)).join(', ')}`,
      );
      expect(Math.max(...latencies)).toBeLessThan(LATENCY_BUDGET_MS);
    });

    it('hai instance (blue-green): client ở instance 2 nhận thay đổi gửi qua instance 1 < 1s', async () => {
      const orderA = await placeOrder(users.a.token);
      const onSecond = await open(users.a.token, port2);
      await onSecond.emitWithAck('order:subscribe', { orderId: orderA });
      const all: OrderUpdate[] = [];
      onSecond.on('order:updated', (u: OrderUpdate) => all.push(u));

      const received = nextEvent<OrderUpdate>(onSecond, 'order:updated');
      const start = performance.now();
      await setStatus(orderA, PAID); // HTTP vào instance 1, event chỉ phát trong instance 1
      const update = await received;
      const latency = performance.now() - start;

      expect(update).toMatchObject({ orderId: orderA, to: PAID });
      expect(latency).toBeLessThan(LATENCY_BUDGET_MS);
      await sleep(200);
      expect(all).toHaveLength(1);
    });
  });

  describe('client mẫu apps/web (OrderSocketClient)', () => {
    /** Client mẫu; `gate` đóng = "mất mạng": lần nối lại bị treo ở bước lấy token. */
    function sampleClient(getToken: () => string = () => users.a.token) {
      let release: (() => void) | undefined;
      let gate: Promise<void> = Promise.resolve();
      const client = new OrderSocketClient({
        url: `http://127.0.0.1:${port}`,
        getAccessToken: async () => {
          await gate;
          return getToken();
        },
        maxRetryDelayMs: 1_000,
      });
      clients.push(client);
      const snapshots: OrderSnapshot[] = [];
      const updates: OrderUpdate[] = [];
      client.onSnapshot((s) => snapshots.push(s));
      client.onUpdate((u) => updates.push(u));
      return {
        client,
        snapshots,
        updates,
        cutNetwork() {
          gate = new Promise((r) => (release = r));
          // Đóng transport phía client như khi rớt mạng (không phải ngắt chủ động).
          (client as unknown as { socket: ClientSocket }).socket.io.engine.close();
        },
        restoreNetwork() {
          release?.();
        },
      };
    }

    it('mất mạng → tự nối lại, tự subscribe lại, bù thay đổi đã lỡ và nhận tiếp', async () => {
      const orderA = await placeOrder(users.a.token);
      const sample = sampleClient();
      sample.client.track(orderA);
      await waitUntil(() => sample.snapshots.length === 1);
      expect(sample.snapshots[0]?.status).toBe(PENDING_PAYMENT);

      sample.cutNetwork();
      await waitUntil(() => sample.client.connection === 'reconnecting');
      await setStatus(orderA, PAID); // xảy ra lúc client đang mất kết nối
      await sleep(200);
      expect(sample.updates).toEqual([]);

      sample.restoreNetwork();
      await waitUntil(() => sample.snapshots.length === 2);
      expect(sample.client.connection).toBe('connected');
      // Ack của lần subscribe lại mang trạng thái mới → bù được thay đổi đã lỡ.
      expect(sample.snapshots[1]?.status).toBe(PAID);

      await setStatus(orderA, PROCESSING);
      await waitUntil(() => sample.updates.length === 1);
      expect(sample.updates[0]).toMatchObject({ orderId: orderA, from: PAID, to: PROCESSING });
    });

    it('token hết hạn khi đang kết nối → server ngắt, client nối lại bằng token mới, vẫn theo dõi đơn', async () => {
      const orderA = await placeOrder(users.a.token);
      const shortLived = await app
        .get(JwtService)
        .signAsync({ sub: users.a.id, role: Role.CUSTOMER }, { expiresIn: 2 });
      let token = shortLived;
      const sample = sampleClient(() => token);
      sample.client.track(orderA);
      await waitUntil(() => sample.snapshots.length === 1);

      token = users.a.token; // app đã refresh token
      await waitUntil(() => sample.client.connection === 'reconnecting', 4_000);
      await waitUntil(() => sample.snapshots.length === 2, 4_000);
      expect(sample.client.connection).toBe('connected');

      await setStatus(orderA, PAID);
      await waitUntil(() => sample.updates.length === 1);
      expect(sample.updates[0]).toMatchObject({ orderId: orderA, to: PAID });
    });

    it('đơn của người khác → báo lỗi và thôi theo dõi', async () => {
      const orderB = await placeOrder(users.b.token);
      const sample = sampleClient();
      const errors: string[] = [];
      sample.client.onError((error, orderId) => errors.push(`${orderId}:${error.code}`));

      sample.client.track(orderB);
      await waitUntil(() => errors.length === 1);
      expect(errors).toEqual([`${orderB}:ORDER_NOT_FOUND`]);
      expect(sample.client.trackedOrderIds).toEqual([]);
    });
  });
});
