import { INestApplication } from '@nestjs/common';
import type Redis from 'ioredis';
import request, { Response } from 'supertest';
import { formatWait } from '../src/common/messages/vi';
import { REDIS_CLIENT } from '../src/database/redis.constants';
import { loginAttemptKeys } from '../src/modules/auth/login-attempts.repository';
import { createTestApp } from './create-test-app';

// Mặc định: LOGIN_MAX_FAILED_ATTEMPTS=5, khoá 60 → 300 → 1800 giây (ADR-0008).
const MAX_FAILURES = 5;
const PASSWORD = 'MatKhau123';
const WRONG = 'SaiMatKhau9';

// IP khác nhau cho từng request: chứng minh bộ đếm theo email, không theo IP.
let ipSeq = 0;
const nextIp = () => `198.51.100.${++ipSeq}`;

function expectLocked(res: Response, expectedSeconds: number): void {
  expect(res.status).toBe(429);
  const retryAfter = Number(res.headers['retry-after']);
  // Vài giây trôi qua giữa lúc khoá và lúc đọc TTL.
  expect(retryAfter).toBeLessThanOrEqual(expectedSeconds);
  expect(retryAfter).toBeGreaterThan(expectedSeconds - 5);
  expect(res.body).toMatchObject({
    statusCode: 429,
    code: 'LOGIN_LOCKED',
    message: `Bạn đã nhập sai mật khẩu nhiều lần nên đăng nhập tạm bị khoá. Vui lòng thử lại sau ${formatWait(retryAfter)}.`,
    details: { retryAfterSeconds: retryAfter },
  });
}

describe('Khoá đăng nhập theo email (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let redis: Redis;
  let emailSeq = 0;

  const login = (email: string, password: string) =>
    http.post('/api/auth/login').set('X-Forwarded-For', nextIp()).send({ email, password });

  async function newAccount(): Promise<string> {
    const email = `lockout${++emailSeq}@shopfast.local`;
    await http
      .post('/api/auth/register')
      .set('X-Forwarded-For', nextIp())
      .send({ email, password: PASSWORD, fullName: 'Khách khoá' })
      .expect(201);
    return email;
  }

  /** Sai (MAX−1) lần → 401, lần thứ MAX → trả response 429. */
  async function failUntilLocked(email: string): Promise<Response> {
    for (let i = 1; i < MAX_FAILURES; i++) {
      const res = await login(email, WRONG);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    }
    return login(email, WRONG);
  }

  /** Mô phỏng hết thời gian khoá (giữ nguyên số lần đã bị khoá). */
  const expireLock = (email: string) => redis.del(loginAttemptKeys(email).lock);

  beforeAll(async () => {
    ({ app } = await createTestApp());
    http = request(app.getHttpServer());
    redis = app.get<Redis>(REDIS_CLIENT);
  });

  afterAll(async () => {
    await app.close();
  });

  it(`sai ${MAX_FAILURES} lần từ ${MAX_FAILURES} IP khác nhau → khoá 60 giây`, async () => {
    const email = await newAccount();

    expectLocked(await failUntilLocked(email), 60);
  });

  it('đang khoá: mật khẩu đúng cũng bị từ chối, từ IP nào cũng vậy', async () => {
    const email = await newAccount();
    await failUntilLocked(email);

    expectLocked(await login(email, PASSWORD), 60);
    expectLocked(await login(email, WRONG), 60);
  });

  it('khoá tăng dần 60 → 300 → 1800 giây, sau đó giữ ở 1800', async () => {
    const email = await newAccount();

    for (const seconds of [60, 300, 1800, 1800]) {
      expectLocked(await failUntilLocked(email), seconds);
      await expireLock(email);
    }
  });

  it('đăng nhập đúng thì reset: lại cần đủ số lần sai, và quay về mức 60 giây', async () => {
    const email = await newAccount();
    expectLocked(await failUntilLocked(email), 60);
    await expireLock(email);
    expectLocked(await failUntilLocked(email), 300);
    await expireLock(email);

    // Sai vài lần rồi đúng → bộ đếm và số lần bị khoá đều về 0.
    await login(email, WRONG).expect(401);
    await login(email, PASSWORD).expect(200);

    expectLocked(await failUntilLocked(email), 60);
  });

  it('email không có hoa/thường hay khoảng trắng riêng: cùng một bộ đếm', async () => {
    const email = await newAccount();
    for (let i = 1; i < MAX_FAILURES; i++) {
      await login(i % 2 ? email.toUpperCase() : ` ${email} `, WRONG).expect(401);
    }

    expectLocked(await login(email, WRONG), 60);
  });

  it('email không tồn tại bị khoá y hệt (không dò được email nào đã đăng ký)', async () => {
    const real = await newAccount();
    const ghost = `khong-ton-tai-${emailSeq}@shopfast.local`;

    const realLocked = await failUntilLocked(real);
    const ghostLocked = await failUntilLocked(ghost);

    expectLocked(realLocked, 60);
    expectLocked(ghostLocked, 60);
    expect(ghostLocked.body.message).toBe(realLocked.body.message);
  });

  it('khoá email A không ảnh hưởng email B', async () => {
    const [a, b] = [await newAccount(), await newAccount()];
    await failUntilLocked(a);

    await login(b, PASSWORD).expect(200);
    expectLocked(await login(a, PASSWORD), 60);
  });

  it('Redis không chứa email thô', async () => {
    const email = await newAccount();
    await login(email, WRONG).expect(401);

    expect(await redis.keys(`*${email}*`)).toEqual([]);
    expect(await redis.exists(loginAttemptKeys(email).fail)).toBe(1);
  });
});
