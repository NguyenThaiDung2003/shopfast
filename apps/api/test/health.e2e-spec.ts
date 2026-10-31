import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import { REDIS_CLIENT } from '../src/database/redis.constants';
import { createTestApp } from './create-test-app';

/** Client Redis trỏ vào cổng không có Redis (cùng cấu hình fail-fast như REDIS_CLIENT thật). */
function deadRedis(): Redis {
  const client = new Redis('redis://127.0.0.1:1', {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 100,
    connectTimeout: 200,
    retryStrategy: () => null,
  });
  client.on('error', () => undefined);
  client.connect().catch(() => undefined);
  return client;
}

describe('Health (e2e)', () => {
  describe('mọi phụ thuộc ổn', () => {
    let app: INestApplication;

    beforeAll(async () => {
      ({ app } = await createTestApp());
    });

    afterAll(async () => {
      await app.close();
    });

    it('GET /health (ngoài /api): 200 ok, có trạng thái DB và Redis', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);

      expect(res.body).toMatchObject({
        status: 'ok',
        checks: {
          database: { status: 'up', latencyMs: expect.any(Number) },
          redis: { status: 'up', latencyMs: expect.any(Number) },
        },
        uptimeSeconds: expect.any(Number),
      });
    });

    it('GET /health/live: 200, chỉ tiến trình', async () => {
      const res = await request(app.getHttpServer()).get('/health/live').expect(200);
      expect(res.body).toEqual({
        status: 'ok',
        uptimeSeconds: expect.any(Number),
        commit: expect.any(String),
      });
    });

    it('đường dẫn cũ /api/health → 308 sang /health', async () => {
      const res = await request(app.getHttpServer()).get('/api/health').expect(308);
      expect(res.headers.location).toBe('/health');
    });

    it('route không tồn tại trả 404 với thông điệp tiếng Việt', async () => {
      const res = await request(app.getHttpServer()).get('/api/khong-ton-tai').expect(404);

      expect(res.body).toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Không tìm thấy tài nguyên được yêu cầu.',
      });
    });
  });

  describe('Redis chết → degraded, ứng dụng vẫn phục vụ', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const redis = deadRedis();
      ({ app } = await createTestApp({
        override: (builder) => builder.overrideProvider(REDIS_CLIENT).useValue(redis),
      }));
    });

    afterAll(async () => {
      await app.close();
    });

    it('/health 200 degraded; catalog (cache suy giảm về DB) vẫn 200', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);
      expect(res.body).toMatchObject({
        status: 'degraded',
        checks: { database: { status: 'up' }, redis: { status: 'down' } },
      });

      await request(app.getHttpServer()).get('/api/products?limit=1').expect(200);
      await request(app.getHttpServer()).get('/health/live').expect(200);
    });
  });

  describe('DB chết → 503, liveness vẫn 200', () => {
    let app: INestApplication;
    const DEAD_DB = 'postgresql://shopfast:bi-mat-khong-lo@127.0.0.1:1/shopfast?connect_timeout=1';

    beforeAll(async () => {
      ({ app } = await createTestApp({
        override: (builder) =>
          builder
            .overrideProvider(PrismaService)
            .useValue(
              new PrismaService({ get: () => DEAD_DB } as unknown as ConstructorParameters<
                typeof PrismaService
              >[0]),
            ),
      }));
    });

    afterAll(async () => {
      await app.close();
    });

    it('/health 503 tiếng Việt, không lộ chuỗi kết nối; /health/live 200', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(503);

      expect(res.body).toMatchObject({
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: expect.stringContaining('cơ sở dữ liệu'),
        details: { status: 'error', checks: { database: { status: 'down' } } },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/bi-mat|127\.0\.0\.1|postgresql/);

      await request(app.getHttpServer()).get('/health/live').expect(200);
    });
  });
});
