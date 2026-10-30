import { DRAIN_MS, QUEUE_PREFIX } from './shutdown.env';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { Queue } from 'bullmq';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import type { EnvironmentVariables } from '../src/config/env.validation';
import { PrismaService } from '../src/database/prisma.service';
import { CatalogRepository } from '../src/modules/catalog/catalog.repository';
import { ShutdownService } from '../src/modules/health/shutdown.service';
import { queueConnection } from '../src/modules/jobs/queue-connection';
import { EMAIL_QUEUE, EmailJob, orderJobId } from '../src/modules/jobs/queues';
import { CapturingMailSender, createTestApp } from './create-test-app';

const PASSWORD = 'MatKhau123';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Tắt êm (ADR-0012): app.close() là đúng những gì SIGTERM gọi (enableShutdownHooks).
 * Mỗi test dựng app riêng vì test đóng app ở giữa.
 */
describe('Graceful shutdown (e2e)', () => {
  let prisma: PrismaService;
  let productId = 0;

  async function startApp(): Promise<{ app: INestApplication; mail: CapturingMailSender }> {
    const { app, mailSender } = await createTestApp();
    // Hẹn giờ cứng không được giết process Jest nếu test treo.
    app.get(ShutdownService).exit = jest.fn();
    prisma = app.get(PrismaService);
    return { app, mail: mailSender };
  }

  beforeAll(async () => {
    const { app } = await startApp();
    const category = await prisma.category.create({
      data: { name: 'E2E Shutdown', slug: `e2e-shutdown-${process.pid}` },
    });
    const brand = await prisma.brand.create({
      data: { name: 'E2E Shutdown', slug: `e2e-shutdown-${process.pid}` },
    });
    productId = (
      await prisma.product.create({
        data: {
          sku: `SHD-${process.pid}`,
          name: 'Loa E2E shutdown',
          slug: `loa-e2e-shutdown-${process.pid}`,
          price: 300_000,
          stock: 100,
          categoryId: category.id,
          brandId: brand.id,
        },
      })
    ).id;
    await prisma.user.create({
      data: {
        email: `cus.shutdown.${process.pid}@shopfast.local`,
        role: Role.CUSTOMER,
        fullName: 'E2E shutdown',
        passwordHash: await hash(PASSWORD, 4),
      },
    });
    await app.close();
  });

  it('request đang chạy vẫn hoàn tất (DB còn mở); lúc drain /health 503, /health/live 200', async () => {
    const { app } = await startApp();
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

    // Request chậm 1 giây: đọc DB SAU khi quá trình tắt đã bắt đầu.
    const repository = app.get(CatalogRepository);
    const findById = repository.findById.bind(repository);
    jest.spyOn(repository, 'findById').mockImplementation(async (id) => {
      await sleep(1_000);
      return findById(id);
    });

    const inFlight = fetch(`${base}/api/products/${productId}`);
    await sleep(150);
    const startedClose = Date.now();
    const closing = app.close();

    await sleep(100);
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(503);
    expect(await health.json()).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      details: { status: 'shutting_down' },
    });
    expect((await fetch(`${base}/health/live`)).status).toBe(200);

    const response = await inFlight;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: productId, name: 'Loa E2E shutdown' });

    await closing;
    expect(Date.now() - startedClose).toBeGreaterThanOrEqual(DRAIN_MS - 50);
    // Đã đóng: không nhận kết nối mới.
    await expect(fetch(`${base}/health/live`)).rejects.toThrow();
  });

  it('worker hoàn tất job đang chạy trước khi app đóng (không stalled/failed)', async () => {
    const { app, mail } = await startApp();
    const http = request(app.getHttpServer());
    const email = `cus.shutdown.${process.pid}@shopfast.local`;
    const login = await http
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };

    mail.delayMs = 2_000; // SMTP chậm: job email còn đang chạy khi bắt đầu tắt
    await http.post('/api/cart/items').set(auth).send({ productId, quantity: 1 }).expect(201);
    const { body: order } = await http.post('/api/orders').set(auth).expect(201);

    const config = app.get(ConfigService<EnvironmentVariables, true>);
    const queue = new Queue(EMAIL_QUEUE, {
      connection: queueConnection(config.get('REDIS_URL', { infer: true })),
      prefix: QUEUE_PREFIX,
    });
    try {
      const jobId = orderJobId(EmailJob.ORDER_CONFIRMATION, order.id);
      let state = '';
      for (let i = 0; i < 100 && state !== 'active'; i++) {
        await sleep(50);
        state = (await (await queue.getJob(jobId))?.getState()) ?? '';
      }
      expect(state).toBe('active');
      expect(mail.to(email)).toHaveLength(0);

      await app.close();

      // close() chỉ resolve sau khi job đang chạy đã xong.
      expect(mail.to(email).map((m) => m.subject)).toEqual([expect.stringContaining(order.code)]);
      expect(await (await queue.getJob(jobId))?.getState()).toBe('completed');
    } finally {
      await queue.close();
    }
  });
});
