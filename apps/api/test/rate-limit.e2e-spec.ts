import { LIMITS } from './rate-limit.env';
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request, { Response } from 'supertest';
import { formatWait } from '../src/common/messages/vi';
import { REDIS_CLIENT } from '../src/database/redis.constants';
import { createTestApp } from './create-test-app';

const PASSWORD = 'MatKhau123';

// Mỗi test dùng IP riêng (TEST-NET-3) để bộ đếm không lẫn nhau; Express tin 1 proxy (setup-env).
let ipSeq = 0;
const nextIp = () => `203.0.113.${++ipSeq}`;

function expectTooManyRequests(res: Response, maxSeconds: number): number {
  expect(res.status).toBe(429);
  const retryAfter = Number(res.headers['retry-after']);
  expect(retryAfter).toBeGreaterThan(0);
  expect(retryAfter).toBeLessThanOrEqual(maxSeconds);
  expect(res.body).toMatchObject({
    statusCode: 429,
    code: 'TOO_MANY_REQUESTS',
    message: `Bạn thao tác quá nhanh, vui lòng thử lại sau ${formatWait(retryAfter)}.`,
    details: { retryAfterSeconds: retryAfter },
  });
  return retryAfter;
}

describe('Rate limit (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let userSeq = 0;

  const from = (ip: string) => ({ 'X-Forwarded-For': ip });

  async function registerCustomer(): Promise<string> {
    const res = await http
      .post('/api/auth/register')
      .set(from(nextIp()))
      .send({ email: `rl${++userSeq}@shopfast.local`, password: PASSWORD, fullName: 'Khách RL' })
      .expect(201);
    return res.body.accessToken as string;
  }

  beforeAll(async () => {
    ({ app } = await createTestApp());
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  describe('hạn mức chung', () => {
    it('đếm gộp mọi route của một IP; vượt → 429 + Retry-After + thông điệp có số giây', async () => {
      const ip = nextIp();
      const routes = ['/api/products', '/api/products/555001', '/api/products?limit=1'];
      for (let i = 0; i < LIMITS.global; i++) {
        const res = await http.get(routes[i % routes.length]!).set(from(ip));
        expect(res.status).not.toBe(429);
      }

      const blocked = await http.get('/api/products/1').set(from(ip));
      expectTooManyRequests(blocked, 60);
    });

    it('IP khác không bị ảnh hưởng; X-Forwarded-For giả chèn bên trái không lách được', async () => {
      const ip = nextIp();
      for (let i = 0; i < LIMITS.global; i++) await http.get('/api/products').set(from(ip));
      expect((await http.get('/api/products').set(from(ip))).status).toBe(429);

      await http.get('/api/products').set(from(nextIp())).expect(200);
      // Nginx nối IP thật vào cuối; client chỉ kiểm soát được phần bên trái.
      const spoofed = await http.get('/api/products').set(from(`198.51.100.7, ${ip}`));
      expect(spoofed.status).toBe(429);
    });

    it('đã đăng nhập thì đếm theo userId: cùng IP vẫn tách người, đổi IP vẫn bị chặn', async () => {
      const [alice, bob] = [await registerCustomer(), await registerCustomer()];
      const sharedIp = nextIp();
      const me = (token: string, ip: string) =>
        http.get('/api/auth/me').set(from(ip)).set('Authorization', `Bearer ${token}`);

      for (let i = 0; i < LIMITS.global; i++) await me(alice, sharedIp).expect(200);
      expectTooManyRequests(await me(alice, sharedIp), 60);

      await me(bob, sharedIp).expect(200);
      expect((await me(alice, nextIp())).status).toBe(429);
      // Khách chưa đăng nhập cùng IP dùng bộ đếm IP riêng, chưa bị tiêu.
      await http.get('/api/products').set(from(sharedIp)).expect(200);
    });

    it('/api/health không tính vào hạn mức', async () => {
      const ip = nextIp();
      for (let i = 0; i < LIMITS.global * 2; i++) {
        await http.get('/api/health').set(from(ip)).expect(200);
      }
      await http.get('/api/products').set(from(ip)).expect(200);
    });
  });

  describe('hạn mức riêng', () => {
    it('POST /auth/login: chặn theo IP sớm hơn hạn mức chung', async () => {
      const ip = nextIp();
      // Email khác nhau mỗi lần để khoá theo email (login-lockout.e2e) không xen vào.
      for (let i = 0; i < LIMITS.login; i++) {
        await http
          .post('/api/auth/login')
          .set(from(ip))
          .send({ email: `khongco${i}@shopfast.local`, password: 'SaiMatKhau9' })
          .expect(401);
      }

      const blocked = await http
        .post('/api/auth/login')
        .set(from(ip))
        .send({ email: 'khongco-x@shopfast.local', password: 'SaiMatKhau9' });
      expectTooManyRequests(blocked, 60);
      // Hạn mức chung của IP này vẫn còn.
      await http.get('/api/products').set(from(ip)).expect(200);
    });

    it('POST /auth/otp/send: chặn theo IP, Retry-After theo cửa sổ 5 phút', async () => {
      const ip = nextIp();
      const send = (n: number) =>
        http
          .post('/api/auth/otp/send')
          .set(from(ip))
          .send({ email: `otp${n}@shopfast.local`, purpose: 'VERIFY_EMAIL' });
      for (let i = 0; i < LIMITS.otpSend; i++) await send(i).expect(202);

      const retryAfter = expectTooManyRequests(await send(99), 300);
      expect(retryAfter).toBeGreaterThan(60);
    });

    it('POST /orders (đơn khuyến mãi): chặn theo user, user khác cùng IP vẫn đặt được', async () => {
      const [alice, bob] = [await registerCustomer(), await registerCustomer()];
      const ip = nextIp();
      const order = (token: string) =>
        http.post('/api/orders').set(from(ip)).set('Authorization', `Bearer ${token}`);

      // Giỏ trống nên đơn không tạo được, nhưng lượt gọi vẫn bị tính.
      for (let i = 0; i < LIMITS.promoOrder; i++) expect((await order(alice)).status).not.toBe(429);
      expectTooManyRequests(await order(alice), 60);

      expect((await order(bob)).status).not.toBe(429);
    });
  });

  describe('Redis không dùng được', () => {
    it('cho qua: vượt hạn mức vẫn 200, đăng nhập sai nhiều lần không bị khoá', async () => {
      await registerCustomer();
      const email = `rl${userSeq}@shopfast.local`;
      const broken = new Redis('redis://127.0.0.1:1', {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        commandTimeout: 100,
        retryStrategy: () => null,
      });
      broken.on('error', () => undefined);
      broken.connect().catch(() => undefined);
      const { app: degraded } = await createTestApp({
        override: (builder) => builder.overrideProvider(REDIS_CLIENT).useValue(broken),
      });
      const api = request(degraded.getHttpServer());
      const ip = nextIp();
      try {
        for (let i = 0; i < LIMITS.global + 2; i++) {
          await api.get('/api/products').set(from(ip)).expect(200);
        }
        for (let i = 0; i < 6; i++) {
          await api
            .post('/api/auth/login')
            .set(from(ip))
            .send({ email, password: 'SaiMatKhau9' })
            .expect(401);
        }
        await api
          .post('/api/auth/login')
          .set(from(ip))
          .send({ email, password: PASSWORD })
          .expect(200);
      } finally {
        await degraded.close();
        broken.disconnect();
      }
    });
  });
});
