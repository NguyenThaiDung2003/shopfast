import { INVOICE_DIR } from './jobs.env';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { OrderStatus, Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { Job, Queue } from 'bullmq';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import { formatVnd } from '../src/modules/jobs/email-templates';
import {
  PARTNER_INVENTORY_CLIENT,
  PartnerInventoryClient,
  PartnerStockChange,
  PartnerUnavailableError,
} from '../src/modules/jobs/partner-inventory.client';
import {
  DAILY_REPORT_CRON,
  DAILY_REPORT_SCHEDULER_ID,
  DEAD_LETTER_QUEUE,
  DeadLetterData,
  EMAIL_QUEUE,
  EmailJob,
  INVENTORY_SYNC_QUEUE,
  InventorySyncJob,
  INVOICE_JOB,
  INVOICE_QUEUE,
  orderJobId,
} from '../src/modules/jobs/queues';
import { CapturingMailSender, createTestApp } from './create-test-app';

const PASSWORD = 'MatKhau123';
const { PENDING_PAYMENT, PAID, CANCELLED } = OrderStatus;

/** Đối tác giả lập điều khiển được: lỗi N lần đầu cho từng đơn rồi mới thành công. */
class ScriptedPartner implements PartnerInventoryClient {
  readonly calls: PartnerStockChange[] = [];
  private readonly failures = new Map<string, number>();

  failTimes(orderCode: string, times: number): void {
    this.failures.set(orderCode, times);
  }

  async pushStockChange(change: PartnerStockChange): Promise<void> {
    this.calls.push(change);
    const left = this.failures.get(change.orderCode) ?? 0;
    if (left > 0) {
      this.failures.set(change.orderCode, left - 1);
      throw new PartnerUnavailableError();
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Chờ job xuất hiện (listener đẩy bất đồng bộ) và đạt một trong các trạng thái. */
async function waitForJob(
  queue: Queue,
  jobId: string,
  states: string[] = ['completed', 'failed'],
  timeoutMs = 10_000,
): Promise<Job> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await queue.getJob(jobId);
    const state = job ? await job.getState() : 'missing';
    if (job && states.includes(state)) return (await queue.getJob(jobId))!;
    if (Date.now() > deadline) {
      throw new Error(`Job ${queue.name}/${jobId} is "${state}", expected ${states.join('|')}`);
    }
    await sleep(25);
  }
}

describe('Background jobs (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let mail: CapturingMailSender;
  const partner = new ScriptedPartner();
  const queues = {} as Record<'email' | 'invoice' | 'inventory' | 'deadLetter', Queue>;
  const tokens = { customer: '', warehouse: '', admin: '' };
  const users = {
    customer: { id: '', email: 'cus.jobs.e2e@shopfast.local' },
    admin: { id: '', email: 'admin.jobs.e2e@shopfast.local' },
  };
  let productId = 0;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const subjectsFor = (code: string) =>
    mail
      .to(users.customer.email)
      .filter((m) => m.subject.includes(code))
      .map((m) => m.subject);

  async function placeOrder(): Promise<{ id: string; code: string }> {
    await http
      .post('/api/cart/items')
      .set(auth(tokens.customer))
      .send({ productId, quantity: 1 })
      .expect(201);
    const { body } = await http.post('/api/orders').set(auth(tokens.customer)).expect(201);
    return { id: body.id, code: body.code };
  }

  const setStatus = (orderId: string, status: OrderStatus) =>
    http
      .patch(`/api/orders/${orderId}/status`)
      .set(auth(tokens.warehouse))
      .send({ status })
      .expect(200);

  async function createUser(email: string, role: Role): Promise<[string, string]> {
    const user = await prisma.user.create({
      data: { email, role, fullName: `Jobs ${role}`, passwordHash: await hash(PASSWORD, 4) },
    });
    const res = await http.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return [user.id, res.body.accessToken];
  }

  beforeAll(async () => {
    ({ app, mailSender: mail } = await createTestApp({
      override: (builder) => builder.overrideProvider(PARTNER_INVENTORY_CLIENT).useValue(partner),
    }));
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    queues.email = app.get(getQueueToken(EMAIL_QUEUE));
    queues.invoice = app.get(getQueueToken(INVOICE_QUEUE));
    queues.inventory = app.get(getQueueToken(INVENTORY_SYNC_QUEUE));
    queues.deadLetter = app.get(getQueueToken(DEAD_LETTER_QUEUE));

    const category = await prisma.category.create({ data: { name: 'E2E Jobs', slug: 'e2e-jobs' } });
    const brand = await prisma.brand.create({ data: { name: 'E2E Jobs', slug: 'e2e-jobs' } });
    productId = (
      await prisma.product.create({
        data: {
          sku: 'JOB-001',
          name: 'Loa E2E',
          slug: 'loa-e2e-jobs',
          price: 1_200_000,
          stock: 1_000,
          categoryId: category.id,
          brandId: brand.id,
        },
      })
    ).id;
    [users.customer.id, tokens.customer] = await createUser(users.customer.email, Role.CUSTOMER);
    [, tokens.warehouse] = await createUser('wh.jobs.e2e@shopfast.local', Role.WAREHOUSE);
    [users.admin.id, tokens.admin] = await createUser(users.admin.email, Role.ADMIN);
  });

  afterAll(async () => {
    await app.close();
    await rm(INVOICE_DIR, { recursive: true, force: true });
  });

  describe('đặt đơn', () => {
    it('API trả 201 ngay, không chờ job (SMTP chậm 3 giây)', async () => {
      mail.delayMs = 3_000;
      try {
        const started = Date.now();
        const order = await placeOrder();
        expect(Date.now() - started).toBeLessThan(1_500);

        const job = await waitForJob(
          queues.email,
          orderJobId(EmailJob.ORDER_CONFIRMATION, order.id),
        );
        expect(job.returnvalue).toEqual({ status: 'sent', sent: 1 });
      } finally {
        mail.delayMs = 0;
      }
    });

    it('đẩy đủ job với jobId cố định: xác nhận, đồng bộ kho, nhắc thanh toán hẹn giờ', async () => {
      const order = await placeOrder();

      await waitForJob(queues.email, orderJobId(EmailJob.ORDER_CONFIRMATION, order.id));
      await waitForJob(queues.inventory, orderJobId(InventorySyncJob.RESERVE, order.id));
      const reminder = await waitForJob(
        queues.email,
        orderJobId(EmailJob.PAYMENT_REMINDER, order.id),
        ['delayed'],
      );
      expect(reminder.opts.delay).toBe(600_000);
      expect(reminder.data).toEqual({ orderId: order.id, code: order.code });
      expect(subjectsFor(order.code)).toEqual([`[ShopFast] Xác nhận đơn hàng ${order.code}`]);
    });
  });

  describe('idempotent', () => {
    it('chạy job email 2 lần → chỉ 1 email và 1 dòng email_deliveries', async () => {
      const order = await placeOrder();
      const jobId = orderJobId(EmailJob.ORDER_CONFIRMATION, order.id);
      await waitForJob(queues.email, jobId);

      // Chạy lại tay cùng job (jobId khác để BullMQ không chặn) → worker thấy đã gửi, bỏ qua.
      await queues.email.add(
        EmailJob.ORDER_CONFIRMATION,
        { orderId: order.id, code: order.code },
        {
          jobId: `${jobId}-rerun`,
        },
      );
      const rerun = await waitForJob(queues.email, `${jobId}-rerun`);

      expect(rerun.returnvalue).toEqual({ status: 'skipped', reason: 'already_sent' });
      expect(subjectsFor(order.code)).toHaveLength(1);
      expect(
        await prisma.emailDelivery.count({
          where: { kind: EmailJob.ORDER_CONFIRMATION, ref: order.id },
        }),
      ).toBe(1);
    });

    it('đẩy lại cùng jobId khi job cũ còn lưu → BullMQ bỏ qua, không chạy lần hai', async () => {
      const order = await placeOrder();
      const jobId = orderJobId(EmailJob.ORDER_CONFIRMATION, order.id);
      const first = await waitForJob(queues.email, jobId);

      const again = await queues.email.add(
        EmailJob.ORDER_CONFIRMATION,
        { orderId: order.id, code: order.code },
        { jobId },
      );
      await sleep(200);

      expect(again.id).toBe(first.id);
      expect((await queues.email.getJob(jobId))!.finishedOn).toBe(first.finishedOn);
      expect(subjectsFor(order.code)).toHaveLength(1);
    });
  });

  describe('retry & dead-letter', () => {
    it('đối tác lỗi 2 lần rồi thành công → job hoàn tất ở lần thử 3, không vào dead-letter', async () => {
      // Job reserve chạy ngay khi đặt đơn, chưa kịp cài lỗi; dùng job release (đẩy khi huỷ)
      // để cài lỗi trước khi job tồn tại.
      const order = await placeOrder();
      await waitForJob(queues.inventory, orderJobId(InventorySyncJob.RESERVE, order.id));
      partner.failTimes(order.code, 2);

      await setStatus(order.id, CANCELLED);
      const job = await waitForJob(
        queues.inventory,
        orderJobId(InventorySyncJob.RELEASE, order.id),
      );

      expect(await job.getState()).toBe('completed');
      expect(job.attemptsMade).toBe(3);
      expect(
        partner.calls.filter((c) => c.orderCode === order.code && c.action === 'release'),
      ).toHaveLength(3);
      expect(await queues.deadLetter.getJob(`${INVENTORY_SYNC_QUEUE}-${job.id}`)).toBeUndefined();
    });

    it('lỗi đủ số lần (6) → job failed và vào dead-letter kèm lý do, số lần thử, dữ liệu gốc', async () => {
      const order = await placeOrder();
      await waitForJob(queues.inventory, orderJobId(InventorySyncJob.RESERVE, order.id));
      partner.failTimes(order.code, Number.POSITIVE_INFINITY);

      await setStatus(order.id, CANCELLED);
      const jobId = orderJobId(InventorySyncJob.RELEASE, order.id);
      const job = await waitForJob(queues.inventory, jobId);

      expect(await job.getState()).toBe('failed');
      expect(job.attemptsMade).toBe(6);
      const dead = await waitForJob(queues.deadLetter, `${INVENTORY_SYNC_QUEUE}-${jobId}`, [
        'waiting',
      ]);
      expect(dead.data as DeadLetterData).toMatchObject({
        queue: INVENTORY_SYNC_QUEUE,
        jobName: InventorySyncJob.RELEASE,
        jobId,
        data: { orderId: order.id, code: order.code },
        failedReason: 'Partner inventory API returned 503',
        attemptsMade: 6,
      });
    });

    it('lỗi không thể thử lại (đơn không tồn tại) → dead-letter ngay sau 1 lần', async () => {
      const ghost = '00000000-0000-4000-8000-00000000dead';
      await queues.email.add(
        EmailJob.ORDER_CONFIRMATION,
        { orderId: ghost, code: 'SF-GHOST' },
        {
          jobId: orderJobId(EmailJob.ORDER_CONFIRMATION, ghost),
        },
      );

      const job = await waitForJob(queues.email, orderJobId(EmailJob.ORDER_CONFIRMATION, ghost));
      expect(job.attemptsMade).toBe(1);
      const dead = await waitForJob(queues.deadLetter, `${EMAIL_QUEUE}-${job.id}`, ['waiting']);
      expect((dead.data as DeadLetterData).failedReason).toBe(`Order ${ghost} not found`);
    });
  });

  describe('nhắc thanh toán (delayed 30 phút)', () => {
    it('đến hạn mà đơn vẫn PENDING_PAYMENT → gửi email nhắc', async () => {
      const order = await placeOrder();
      const jobId = orderJobId(EmailJob.PAYMENT_REMINDER, order.id);
      const delayed = await waitForJob(queues.email, jobId, ['delayed']);

      await delayed.promote(); // thay cho chờ 30 phút
      const job = await waitForJob(queues.email, jobId);

      expect(job.returnvalue).toEqual({ status: 'sent', sent: 1 });
      expect(subjectsFor(order.code)).toContain(`[ShopFast] Đơn ${order.code} đang chờ thanh toán`);
    });

    it('đơn đã thanh toán → job hẹn giờ bị gỡ; nếu vẫn chạy thì worker kiểm lại và bỏ qua', async () => {
      const order = await placeOrder();
      const jobId = orderJobId(EmailJob.PAYMENT_REMINDER, order.id);
      await waitForJob(queues.email, jobId, ['delayed']);

      await setStatus(order.id, PAID);
      const deadline = Date.now() + 5_000;
      while ((await queues.email.getJob(jobId)) && Date.now() < deadline) await sleep(25);
      expect(await queues.email.getJob(jobId)).toBeUndefined();

      // Gỡ không kịp (job đã chạy) → worker đọc lại trạng thái đơn.
      await queues.email.add(
        EmailJob.PAYMENT_REMINDER,
        { orderId: order.id, code: order.code },
        {
          jobId,
        },
      );
      const job = await waitForJob(queues.email, jobId);
      expect(job.returnvalue).toEqual({ status: 'skipped', reason: `status_${PAID}` });
      expect(subjectsFor(order.code).some((s) => s.includes('chờ thanh toán'))).toBe(false);
    });
  });

  describe('hoá đơn PDF', () => {
    it('đơn chuyển PAID → lưu <mã đơn>.pdf; chạy lại vẫn 1 file', async () => {
      const order = await placeOrder();
      await setStatus(order.id, PAID);

      const job = await waitForJob(queues.invoice, orderJobId(INVOICE_JOB, order.id));
      expect(job.returnvalue).toMatchObject({ status: 'generated' });
      const pdf = await readFile(join(INVOICE_DIR, `${order.code}.pdf`));
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

      await queues.invoice.add(
        INVOICE_JOB,
        { orderId: order.id, code: order.code },
        {
          jobId: `${orderJobId(INVOICE_JOB, order.id)}-rerun`,
        },
      );
      await waitForJob(queues.invoice, `${orderJobId(INVOICE_JOB, order.id)}-rerun`);
      expect((await readdir(INVOICE_DIR)).filter((f) => f.startsWith(order.code))).toEqual([
        `${order.code}.pdf`,
      ]);
    });

    it('đơn chưa thanh toán → không đẩy job hoá đơn', async () => {
      const order = await placeOrder();
      await waitForJob(queues.email, orderJobId(EmailJob.ORDER_CONFIRMATION, order.id));

      expect(await queues.invoice.getJob(orderJobId(INVOICE_JOB, order.id))).toBeUndefined();
    });
  });

  describe('báo cáo doanh thu 0h hằng ngày', () => {
    it('lịch lặp được đăng ký: cron 0h theo giờ Việt Nam', async () => {
      const deadline = Date.now() + 5_000;
      let scheduler = await queues.email.getJobScheduler(DAILY_REPORT_SCHEDULER_ID);
      while (!scheduler && Date.now() < deadline) {
        await sleep(50);
        scheduler = await queues.email.getJobScheduler(DAILY_REPORT_SCHEDULER_ID);
      }
      expect(scheduler).toMatchObject({ pattern: DAILY_REPORT_CRON, tz: 'Asia/Ho_Chi_Minh' });
    });

    it('tính đúng doanh thu một ngày (giờ VN, trừ đơn huỷ), mỗi admin 1 email, chạy lại không gửi thêm', async () => {
      // Ngày riêng của test, giờ VN: 2020-01-15 00:00 = 2020-01-14T17:00Z.
      const base = { userId: users.customer.id, status: PAID };
      await prisma.order.createMany({
        data: [
          { ...base, totalAmount: 1_000_000, paidAt: new Date('2020-01-14T17:00:00Z') }, // 00:00 VN
          { ...base, totalAmount: 2_500_000, paidAt: new Date('2020-01-15T16:59:59Z') }, // 23:59 VN
          { ...base, totalAmount: 9_000_000, paidAt: new Date('2020-01-15T17:00:00Z') }, // hôm sau
          {
            ...base,
            totalAmount: 7_000_000,
            paidAt: new Date('2020-01-15T03:00:00Z'),
            status: CANCELLED,
          },
          { ...base, totalAmount: 5_000_000, paidAt: new Date('2020-01-14T16:59:59Z') }, // hôm trước
        ],
      });
      const run = async (suffix: string) => {
        await queues.email.add(
          EmailJob.DAILY_REVENUE_REPORT,
          { date: '2020-01-15' },
          {
            jobId: `daily-report-2020-01-15-${suffix}`,
          },
        );
        return waitForJob(queues.email, `daily-report-2020-01-15-${suffix}`);
      };

      const first = await run('a');
      expect(first.returnvalue).toMatchObject({ status: 'sent' });
      const [report] = mail.to(users.admin.email).filter((m) => m.subject.includes('2020-01-15'));
      expect(report!.subject).toBe('[ShopFast] Báo cáo doanh thu ngày 2020-01-15');
      expect(report!.text).toContain(
        `Doanh thu (đơn đã thanh toán, trừ đơn huỷ): ${formatVnd(3_500_000)}`,
      );
      expect(report!.text).toContain('Số đơn đã thanh toán: 2');

      const second = await run('b');
      expect(second.returnvalue).toEqual({ status: 'skipped', reason: 'already_sent' });
      expect(
        mail.to(users.admin.email).filter((m) => m.subject.includes('2020-01-15')),
      ).toHaveLength(1);
    });
  });

  describe('Bull Board /admin/queues & thống kê', () => {
    it('không đăng nhập → 401, customer → 403 (JSON lỗi tiếng Việt chuẩn), admin Bearer → 200', async () => {
      const anonymous = await http.get('/admin/queues').expect(401);
      expect(anonymous.body).toMatchObject({ statusCode: 401, code: 'UNAUTHENTICATED' });
      const customer = await http.get('/admin/queues').set(auth(tokens.customer)).expect(403);
      expect(customer.body).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
      await http.get('/admin/queues').set('Cookie', 'sf_admin_queues=gia-mao').expect(401);

      const admin = await http.get('/admin/queues').set(auth(tokens.admin)).expect(200);
      expect(admin.text).toContain('<html');
    });

    it('POST /api/admin/queues/session → cookie httpOnly dùng được để mở Bull Board', async () => {
      await http.post('/api/admin/queues/session').set(auth(tokens.customer)).expect(403);
      const res = await http.post('/api/admin/queues/session').set(auth(tokens.admin)).expect(204);

      const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? [])[0]!;
      expect(cookie).toMatch(/^sf_admin_queues=/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\/admin\/queues/);
      expect(cookie).toMatch(/Max-Age=\d+/);

      const sessionCookie = cookie.split(';')[0]!;
      const board = await http
        .get('/admin/queues/api/queues')
        .set('Cookie', sessionCookie)
        .expect(200);
      const names = (
        board.body.queues as Array<{ name: string; counts: Record<string, number> }>
      ).map((q) => q.name);
      expect(names.sort()).toEqual(
        [DEAD_LETTER_QUEUE, EMAIL_QUEUE, INVENTORY_SYNC_QUEUE, INVOICE_QUEUE].sort(),
      );
    });

    it('GET /api/admin/queues/stats: số job chờ/chạy/hoàn tất/thất bại của từng queue', async () => {
      await http.get('/api/admin/queues/stats').set(auth(tokens.customer)).expect(403);
      const { body } = await http
        .get('/api/admin/queues/stats')
        .set(auth(tokens.admin))
        .expect(200);

      const byName = Object.fromEntries(
        (body.queues as Array<Record<string, number | string>>).map((q) => [q.name, q]),
      );
      expect(Object.keys(byName).sort()).toEqual(
        [DEAD_LETTER_QUEUE, EMAIL_QUEUE, INVENTORY_SYNC_QUEUE, INVOICE_QUEUE].sort(),
      );
      expect(byName[EMAIL_QUEUE]).toEqual({
        name: EMAIL_QUEUE,
        waiting: expect.any(Number),
        active: expect.any(Number),
        delayed: expect.any(Number),
        completed: expect.any(Number),
        failed: expect.any(Number),
      });
      // Các test trước đã tạo job hoàn tất, thất bại và dead-letter.
      expect(byName[EMAIL_QUEUE]!.completed).toBeGreaterThan(0);
      expect(byName[INVENTORY_SYNC_QUEUE]!.failed).toBeGreaterThan(0);
      expect(byName[DEAD_LETTER_QUEUE]!.waiting).toBeGreaterThan(0);
    });
  });

  describe('Redis của queue không dùng được', () => {
    it.each([
      ['treo, không trả lời', () => new Promise<never>(() => undefined)],
      ['mất kết nối', () => Promise.reject(new Error('Connection is closed.'))],
    ])('%s → POST /orders vẫn 201 ngay, job lỗi chỉ bị log', async (_name, add) => {
      const spies = [queues.email, queues.inventory].map((q) =>
        jest.spyOn(q, 'add').mockImplementation(add as never),
      );
      try {
        await http
          .post('/api/cart/items')
          .set(auth(tokens.customer))
          .send({ productId, quantity: 1 })
          .expect(201);

        const started = Date.now();
        const { body } = await http.post('/api/orders').set(auth(tokens.customer)).expect(201);

        expect(Date.now() - started).toBeLessThan(1_500);
        expect(await prisma.order.count({ where: { id: body.id, status: PENDING_PAYMENT } })).toBe(
          1,
        );
        // Listener đã thử đẩy job (và tự bỏ chờ sau 2 giây nếu treo).
        expect(spies[0]).toHaveBeenCalledWith(
          EmailJob.ORDER_CONFIRMATION,
          expect.objectContaining({ orderId: body.id }),
          expect.anything(),
        );
        await sleep(2_100);
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
    });
  });
});
