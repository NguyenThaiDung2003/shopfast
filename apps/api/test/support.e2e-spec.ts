import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import {
  CategorySource,
  OrderStatus,
  PendingActionStatus,
  Role,
  TicketStatus,
} from '@prisma/client';
import { hash } from 'bcryptjs';
import { Queue } from 'bullmq';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import {
  TICKET_CLASSIFY_JOB,
  TICKET_CLASSIFY_QUEUE,
  ticketJobId,
} from '../src/modules/jobs/queues';
import { LLM_PROVIDER, LlmError } from '../src/modules/llm/llm.types';
import { TicketClassifierService } from '../src/modules/support/ticket-classifier.service';
import { createTestApp } from './create-test-app';
import {
  categoryAnswer,
  finalAnswer,
  ScriptedLlmProvider,
  toolCalls,
} from './scripted-llm.provider';

const PASSWORD = 'MatKhau123';

/**
 * F06 – ticket hỗ trợ + trợ lý AI (ADR-0011). LLM thật không bao giờ được gọi: provider được
 * thay bằng ScriptedLlmProvider, mỗi test đặt kịch bản model sẽ trả.
 */
describe('Support tickets & AI assistant (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const llm = new ScriptedLlmProvider();
  const tokens = { customer: '', other: '', support: '', warehouse: '' };
  const ids = { customer: '', support: '' };
  let productId = 0;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const stock = async () =>
    (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stock;
  const orderStatus = async (id: string) =>
    (await prisma.order.findUniqueOrThrow({ where: { id } })).status;

  async function login(email: string, role: Role, passwordHash: string): Promise<[string, string]> {
    const user = await prisma.user.create({
      data: { email, role, passwordHash, fullName: `E2E ${role}` },
    });
    const res = await http.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return [user.id, res.body.accessToken];
  }

  /** Khách đặt đơn 2 sản phẩm qua API; trả { id, code }. */
  async function placeOrder(): Promise<{ id: string; code: string }> {
    await http
      .post('/api/cart/items')
      .set(auth(tokens.customer))
      .send({ productId, quantity: 2 })
      .expect(201);
    const { body } = await http.post('/api/orders').set(auth(tokens.customer)).expect(201);
    return { id: body.id, code: body.code };
  }

  function createTicket(orderId?: string, key?: string) {
    const req = http.post('/api/support/tickets').set(auth(tokens.customer));
    if (key) req.set('Idempotency-Key', key);
    return req.send({ subject: 'Hỏi về đơn hàng', message: 'Đơn của tôi sao rồi?', orderId });
  }

  const ask = (ticketId: string, question: string, token = tokens.support) =>
    http.post(`/api/support/tickets/${ticketId}/assistant`).set(auth(token)).send({ question });

  beforeAll(async () => {
    ({ app } = await createTestApp({
      override: (builder) => builder.overrideProvider(LLM_PROVIDER).useValue(llm),
    }));
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    const category = await prisma.category.create({ data: { name: 'E2E Sup', slug: 'e2e-sup' } });
    const brand = await prisma.brand.create({ data: { name: 'E2E Sup', slug: 'e2e-sup' } });
    productId = (
      await prisma.product.create({
        data: {
          sku: 'SUP-001',
          name: 'Tai nghe E2E',
          slug: 'tai-nghe-e2e-sup',
          price: 500_000,
          stock: 100,
          categoryId: category.id,
          brandId: brand.id,
        },
      })
    ).id;

    const passwordHash = await hash(PASSWORD, 4);
    [ids.customer, tokens.customer] = await login(
      'cus.sup.e2e@shopfast.local',
      Role.CUSTOMER,
      passwordHash,
    );
    [, tokens.other] = await login('other.sup.e2e@shopfast.local', Role.CUSTOMER, passwordHash);
    [ids.support, tokens.support] = await login(
      'sup.sup.e2e@shopfast.local',
      Role.SUPPORT,
      passwordHash,
    );
    [, tokens.warehouse] = await login('wh.sup.e2e@shopfast.local', Role.WAREHOUSE, passwordHash);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('ticket', () => {
    it('khách tạo ticket → 201, chưa có nhóm, job phân loại vào queue; phân loại lưu đúng nhóm', async () => {
      const order = await placeOrder();
      const created = await createTicket(order.id).expect(201);
      expect(created.body).toMatchObject({
        code: expect.stringMatching(/^TK-\d{6}$/),
        status: TicketStatus.OPEN,
        category: null,
        orderCode: order.code,
        messages: [{ body: 'Đơn của tôi sao rồi?', author: { role: Role.CUSTOMER } }],
      });
      expect(created.body.customer).toBeUndefined();

      // Listener chạy bất đồng bộ sau commit: chờ job xuất hiện (worker tắt trong test).
      const queue = app.get<Queue>(getQueueToken(TICKET_CLASSIFY_QUEUE));
      const jobId = ticketJobId(TICKET_CLASSIFY_JOB, created.body.id);
      let job = await queue.getJob(jobId);
      for (let i = 0; !job && i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100));
        job = await queue.getJob(jobId);
      }
      expect(job?.data).toEqual({ ticketId: created.body.id, code: created.body.code });

      llm.script(categoryAnswer('VAN_CHUYEN'));
      await app.get(TicketClassifierService).classify(created.body.id, { finalAttempt: false });

      const detail = await http
        .get(`/api/support/tickets/${created.body.id}`)
        .set(auth(tokens.support))
        .expect(200);
      expect(detail.body).toMatchObject({
        category: 'VAN_CHUYEN',
        categorySource: CategorySource.LLM,
        customer: { id: ids.customer },
      });
    });

    it('LLM lỗi ở lần thử cuối → KHAC (FALLBACK)', async () => {
      const { body } = await createTicket().expect(201);
      llm.script(new LlmError('timeout', 'x'));
      await app.get(TicketClassifierService).classify(body.id, { finalAttempt: true });
      const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: body.id } });
      expect(ticket).toMatchObject({ category: 'KHAC', categorySource: CategorySource.FALLBACK });
    });

    it('Idempotency-Key: gửi lại → 200 + cùng ticket; gắn đơn của người khác → 404', async () => {
      const first = await createTicket(undefined, 'ticket-key-0001').expect(201);
      const again = await createTicket(undefined, 'ticket-key-0001').expect(200);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.body.id).toBe(first.body.id);

      const order = await placeOrder();
      await http
        .post('/api/support/tickets')
        .set(auth(tokens.other))
        .send({ subject: 'x', message: 'y', orderId: order.id })
        .expect(404);
    });

    it('quyền: khách B không xem/nhắn được ticket của A; khách và kho không dùng được trợ lý', async () => {
      const { body } = await createTicket().expect(201);
      llm.script();

      const other = await http
        .get(`/api/support/tickets/${body.id}`)
        .set(auth(tokens.other))
        .expect(404);
      expect(other.body.code).toBe('TICKET_NOT_FOUND');
      await http
        .post(`/api/support/tickets/${body.id}/messages`)
        .set(auth(tokens.other))
        .send({ body: 'chen ngang' })
        .expect(404);
      await http.get(`/api/support/tickets/${body.id}`).set(auth(tokens.warehouse)).expect(404);
      await http.get('/api/support/tickets').set(auth(tokens.customer)).expect(403);
      await ask(body.id, 'đơn sao rồi', tokens.customer).expect(403);
      await ask(body.id, 'đơn sao rồi', tokens.warehouse).expect(403);
      expect(llm.requests).toHaveLength(0);
    });

    it('hội thoại: nhân viên trả lời → ANSWERED; khách nhắn → OPEN; đóng → không nhắn được', async () => {
      const { body } = await createTicket().expect(201);

      const list = await http
        .get('/api/support/tickets?status=OPEN&limit=50')
        .set(auth(tokens.support))
        .expect(200);
      expect(list.body.items.map((t: { id: string }) => t.id)).toContain(body.id);

      const answered = await http
        .post(`/api/support/tickets/${body.id}/messages`)
        .set(auth(tokens.support))
        .send({ body: 'Chào bạn, mình kiểm tra ngay.' })
        .expect(201);
      expect(answered.body.status).toBe(TicketStatus.ANSWERED);
      expect(answered.body.messages.at(-1).author).toEqual({
        role: Role.SUPPORT,
        fullName: 'E2E SUPPORT',
      });

      const reopened = await http
        .post(`/api/support/tickets/${body.id}/messages`)
        .set(auth(tokens.customer))
        .send({ body: 'Cảm ơn' })
        .expect(201);
      expect(reopened.body.status).toBe(TicketStatus.OPEN);

      await http
        .patch(`/api/support/tickets/${body.id}`)
        .set(auth(tokens.support))
        .send({ status: 'CLOSED', category: 'DON_HANG' })
        .expect(200);
      const closed = await http
        .post(`/api/support/tickets/${body.id}/messages`)
        .set(auth(tokens.customer))
        .send({ body: 'Còn nữa' })
        .expect(409);
      expect(closed.body.code).toBe('TICKET_CLOSED');

      const mine = await http.get('/api/support/tickets/me').set(auth(tokens.customer)).expect(200);
      expect(mine.body.items.find((t: { id: string }) => t.id === body.id)).toMatchObject({
        status: TicketStatus.CLOSED,
        category: 'DON_HANG',
        categorySource: CategorySource.STAFF,
      });
    });
  });

  describe('GET /support/tickets/me – lọc, tìm, số đếm', () => {
    const open = (subject: string, token = tokens.customer) =>
      http
        .post('/api/support/tickets')
        .set(auth(token))
        .send({ subject, message: 'Nội dung' })
        .expect(201)
        .then((res) => res.body as { id: string; code: string });
    const mine = (query: string, token = tokens.customer) =>
      http.get(`/api/support/tickets/me?${query}`).set(auth(token));

    it('lọc nhiều trạng thái, tìm theo tiêu đề/mã (không phân biệt hoa thường), đếm theo từ khoá', async () => {
      const a = await open('Bộ lọc ZEBRA giao chậm');
      const b = await open('Bộ lọc ZEBRA hoá đơn VAT');
      const c = await open('Bộ lọc ZEBRA đổi size');
      await open('Bộ lọc ZEBRA của người khác', tokens.other);
      await http
        .post(`/api/support/tickets/${b.id}/messages`)
        .set(auth(tokens.support))
        .send({ body: 'Đã xuất hoá đơn' })
        .expect(201);
      await http
        .patch(`/api/support/tickets/${c.id}`)
        .set(auth(tokens.support))
        .send({ status: TicketStatus.CLOSED })
        .expect(200);

      const active = await mine('q=zebra&status=OPEN,ANSWERED').expect(200);
      expect(active.body.items.map((t: { id: string }) => t.id).sort()).toEqual(
        [a.id, b.id].sort(),
      );
      expect(active.body.meta.total).toBe(2);
      // Số đếm áp từ khoá nhưng không áp tab; ticket của khách khác không bị đếm.
      expect(active.body.statusCounts).toEqual({ OPEN: 1, ANSWERED: 1, CLOSED: 1 });

      const closed = await mine('q=ZEBRA&status=CLOSED').expect(200);
      expect(closed.body.items.map((t: { id: string }) => t.id)).toEqual([c.id]);

      const byCode = await mine(`q=${a.code.toLowerCase()}`).expect(200);
      expect(byCode.body.items.map((t: { id: string }) => t.id)).toEqual([a.id]);
      expect(byCode.body.statusCounts).toEqual({ OPEN: 1, ANSWERED: 0, CLOSED: 0 });

      const other = await mine('q=zebra', tokens.other).expect(200);
      expect(other.body.meta.total).toBe(1);
    });

    it('hàng chờ nhân viên: tìm theo mã đơn/tên/email khách, đếm theo từ khoá + nhóm', async () => {
      const order = await placeOrder();
      const { body: withOrder } = await createTicket(order.id).expect(201);
      const queue = (query: string) =>
        http.get(`/api/support/tickets?${query}`).set(auth(tokens.support)).expect(200);

      const byOrder = await queue(`q=${order.code.toLowerCase()}`);
      expect(byOrder.body.items.map((t: { id: string }) => t.id)).toEqual([withOrder.id]);
      expect(byOrder.body.items[0].customer).toMatchObject({ email: 'cus.sup.e2e@shopfast.local' });
      expect(byOrder.body.statusCounts).toEqual({ OPEN: 1, ANSWERED: 0, CLOSED: 0 });

      // Cả hai khách đều tên "E2E CUSTOMER"; email thì chỉ khớp khách A.
      type Row = { customer: { email: string } };
      const emails = (res: { body: { items: Row[] } }) =>
        new Set(res.body.items.map((t) => t.customer.email));
      const byName = await queue('q=e2e%20customer&limit=50');
      expect(emails(byName)).toEqual(
        new Set(['cus.sup.e2e@shopfast.local', 'other.sup.e2e@shopfast.local']),
      );
      const byEmail = await queue('q=CUS.SUP.E2E&limit=50');
      expect(emails(byEmail)).toEqual(new Set(['cus.sup.e2e@shopfast.local']));

      const closed = await queue('q=CUS.SUP.E2E&status=CLOSED&limit=50');
      expect(closed.body.meta.total).toBe(closed.body.statusCounts.CLOSED);
      expect(closed.body.statusCounts).toEqual(byEmail.body.statusCounts);
    });

    it('status sai hoặc từ khoá quá 100 ký tự → 400', async () => {
      expect((await mine('status=FOO').expect(400)).body.code).toBe('VALIDATION_FAILED');
      await mine(`q=${'a'.repeat(101)}`).expect(400);
    });
  });

  describe('trợ lý AI', () => {
    it('hỏi về đơn → gọi getOrderStatus, trả lời bằng trạng thái thật trong DB', async () => {
      const order = await placeOrder();
      const { body: ticket } = await createTicket(order.id).expect(201);
      llm.script(toolCalls({ name: 'getOrderStatus', input: { orderRef: order.code } }), (req) => {
        // "Model" đọc kết quả tool vừa nhận để trả lời – giống model thật.
        const last = req.messages.at(-1);
        const result = last?.role === 'tool' ? JSON.parse(last.results[0]!.content) : {};
        return finalAnswer('answer', `Đơn ${result.code} đang "${result.statusLabel}".`);
      });

      const { body } = await ask(ticket.id, 'Đơn của khách đang thế nào?').expect(200);

      expect(body).toMatchObject({
        outcome: 'answered',
        reply: `Đơn ${order.code} đang "Chờ thanh toán".`,
        toolCalls: [{ name: 'getOrderStatus', input: { orderRef: order.code }, ok: true }],
        pendingActions: [],
      });
      const toolResult = JSON.parse(llm.toolResultsAt(1)[0]!.content);
      expect(toolResult).toMatchObject({ code: order.code, status: OrderStatus.PENDING_PAYMENT });
    });

    it('trả lời trạng thái đơn mà không tra → bị chặn (ungrounded)', async () => {
      const order = await placeOrder();
      const { body: ticket } = await createTicket(order.id).expect(201);
      llm.script(
        finalAnswer('answer', `Đơn ${order.code} đang giao, mai tới.`),
        finalAnswer('answer', `Đơn ${order.code} đang giao.`),
      );

      const { body } = await ask(ticket.id, 'Đơn sao rồi?').expect(200);

      expect(body.outcome).toBe('ungrounded');
      expect(body.reply).not.toContain('đang giao');
    });

    it('câu hỏi ngoài phạm vi → out_of_scope, không tool nào chạy', async () => {
      const { body: ticket } = await createTicket().expect(201);
      llm.script(finalAnswer('out_of_scope', 'Xin lỗi, tôi chỉ hỗ trợ nghiệp vụ ShopFast.'));

      const { body } = await ask(ticket.id, 'Giá bitcoin hôm nay bao nhiêu?').expect(200);

      expect(body).toEqual({
        outcome: 'out_of_scope',
        reply: 'Xin lỗi, tôi chỉ hỗ trợ nghiệp vụ ShopFast.',
        toolCalls: [],
        pendingActions: [],
      });
      expect(llm.requests[0]!.system).toContain('Chỉ hỗ trợ nghiệp vụ ShopFast');
    });

    it('LLM lỗi → 503 AI_UNAVAILABLE tiếng Việt; API vẫn phục vụ request kế tiếp', async () => {
      const { body: ticket } = await createTicket().expect(201);
      llm.script(new LlmError('unavailable', 'upstream 529 overloaded'));

      const res = await ask(ticket.id, 'Đơn sao rồi?').expect(503);

      expect(res.body).toMatchObject({
        statusCode: 503,
        code: 'AI_UNAVAILABLE',
        message: expect.stringContaining('Trợ lý AI tạm thời không khả dụng'),
        details: { pendingActionIds: [] },
      });
      expect(JSON.stringify(res.body)).not.toContain('529');
      await http.get('/api/support/tickets').set(auth(tokens.support)).expect(200);
    });
  });

  describe('human-in-the-loop: thao tác ghi chỉ chạy khi nhân viên xác nhận', () => {
    async function proposeCancel(ticketId: string, orderCode: string) {
      llm.script(
        toolCalls({
          name: 'proposeCancelOrder',
          input: { orderRef: orderCode, reason: 'Khách đổi ý' },
        }),
        finalAnswer('answer', 'Đã tạo đề xuất huỷ đơn, chờ nhân viên xác nhận.'),
      );
      const { body } = await ask(ticketId, 'Khách muốn huỷ đơn, xử lý giúp').expect(200);
      expect(body.pendingActions).toHaveLength(1);
      return body.pendingActions[0] as { id: string; status: string; orderCode: string };
    }

    it('lọc đề xuất theo ticket; ticketId sai định dạng → 400', async () => {
      const orderA = await placeOrder();
      const orderB = await placeOrder();
      const { body: ticketA } = await createTicket(orderA.id).expect(201);
      const { body: ticketB } = await createTicket(orderB.id).expect(201);
      const a = await proposeCancel(ticketA.id, orderA.code);
      await proposeCancel(ticketB.id, orderB.code);

      const { body } = await http
        .get(`/api/support/pending-actions?status=PENDING&ticketId=${ticketA.id}`)
        .set(auth(tokens.support))
        .expect(200);
      expect(body.items.map((x: { id: string }) => x.id)).toEqual([a.id]);
      expect(body.items[0]).toMatchObject({ ticketCode: ticketA.code, orderCode: orderA.code });

      await http
        .get('/api/support/pending-actions?ticketId=TK-1')
        .set(auth(tokens.support))
        .expect(400);
    });

    it('đề xuất huỷ → đơn và tồn kho KHÔNG đổi; từ chối → vẫn không đổi; xác nhận → huỷ + hoàn kho', async () => {
      const order = await placeOrder();
      const { body: ticket } = await createTicket(order.id).expect(201);
      const stockAfterOrder = await stock();

      const proposal = await proposeCancel(ticket.id, order.code);
      expect(proposal).toMatchObject({
        status: PendingActionStatus.PENDING,
        orderCode: order.code,
      });
      // Chưa xác nhận: không có gì thay đổi.
      expect(await orderStatus(order.id)).toBe(OrderStatus.PENDING_PAYMENT);
      expect(await stock()).toBe(stockAfterOrder);

      const pending = await http
        .get('/api/support/pending-actions?status=PENDING&limit=50')
        .set(auth(tokens.support))
        .expect(200);
      expect(pending.body.items.map((a: { id: string }) => a.id)).toContain(proposal.id);

      // Khách không xác nhận được.
      await http
        .post(`/api/support/pending-actions/${proposal.id}/confirm`)
        .set(auth(tokens.customer))
        .expect(403);

      const rejected = await http
        .post(`/api/support/pending-actions/${proposal.id}/reject`)
        .set(auth(tokens.support))
        .send({ note: 'Khách gọi lại, giữ đơn' })
        .expect(200);
      expect(rejected.body).toMatchObject({
        status: PendingActionStatus.REJECTED,
        decidedById: ids.support,
        decisionNote: 'Khách gọi lại, giữ đơn',
      });
      expect(await orderStatus(order.id)).toBe(OrderStatus.PENDING_PAYMENT);
      expect(await stock()).toBe(stockAfterOrder);
      // Đã từ chối thì không xác nhận được nữa.
      await http
        .post(`/api/support/pending-actions/${proposal.id}/confirm`)
        .set(auth(tokens.support))
        .expect(409);

      const second = await proposeCancel(ticket.id, order.code);
      expect(await orderStatus(order.id)).toBe(OrderStatus.PENDING_PAYMENT);

      const confirmed = await http
        .post(`/api/support/pending-actions/${second.id}/confirm`)
        .set(auth(tokens.support))
        .send({ note: 'Đã gọi xác nhận với khách' })
        .expect(200);
      expect(confirmed.body.status).toBe(PendingActionStatus.EXECUTED);
      expect(await orderStatus(order.id)).toBe(OrderStatus.CANCELLED);
      expect(await stock()).toBe(stockAfterOrder + 2);

      const history = await prisma.orderStatusHistory.findMany({
        where: { orderId: order.id },
        orderBy: { id: 'asc' },
      });
      expect(history.at(-1)).toMatchObject({
        toStatus: OrderStatus.CANCELLED,
        changedById: ids.support,
        note: expect.stringContaining(ticket.code),
      });

      const again = await http
        .post(`/api/support/pending-actions/${second.id}/confirm`)
        .set(auth(tokens.support))
        .expect(409);
      expect(again.body.code).toBe('ACTION_ALREADY_DECIDED');
    });

    it('hai nhân viên xác nhận cùng lúc → chỉ một lần huỷ', async () => {
      const order = await placeOrder();
      const { body: ticket } = await createTicket(order.id).expect(201);
      const proposal = await proposeCancel(ticket.id, order.code);

      const results = await Promise.all(
        [1, 2].map(() =>
          http
            .post(`/api/support/pending-actions/${proposal.id}/confirm`)
            .set(auth(tokens.support)),
        ),
      );

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const cancellations = await prisma.orderStatusHistory.count({
        where: { orderId: order.id, toStatus: OrderStatus.CANCELLED },
      });
      expect(cancellations).toBe(1);
    });

    it('đơn đã chuyển trạng thái sau khi đề xuất → xác nhận 409, đề xuất FAILED', async () => {
      const order = await placeOrder();
      const { body: ticket } = await createTicket(order.id).expect(201);
      const proposal = await proposeCancel(ticket.id, order.code);
      for (const status of [OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.SHIPPING]) {
        await http
          .patch(`/api/orders/${order.id}/status`)
          .set(auth(tokens.warehouse))
          .send({ status })
          .expect(200);
      }

      const res = await http
        .post(`/api/support/pending-actions/${proposal.id}/confirm`)
        .set(auth(tokens.support))
        .expect(409);

      expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
      expect(await orderStatus(order.id)).toBe(OrderStatus.SHIPPING);
      const action = await prisma.pendingAction.findUniqueOrThrow({ where: { id: proposal.id } });
      expect(action).toMatchObject({
        status: PendingActionStatus.FAILED,
        errorCode: 'INVALID_STATUS_TRANSITION',
      });
    });

    it('đổi trả: đơn chưa giao → tool báo lỗi cho model; đơn đã giao → xác nhận mới tạo yêu cầu', async () => {
      const order = await placeOrder();
      const { body: ticket } = await createTicket(order.id).expect(201);
      const proposeReturn = () =>
        llm.script(
          toolCalls({
            name: 'proposeReturnRequest',
            input: { orderRef: order.code, reason: 'Tai nghe lỗi' },
          }),
          finalAnswer('answer', 'Đã xử lý yêu cầu của bạn.'),
        );

      proposeReturn();
      const early = await ask(ticket.id, 'Khách muốn trả hàng').expect(200);
      expect(early.body.pendingActions).toEqual([]);
      expect(early.body.toolCalls[0]).toMatchObject({ name: 'proposeReturnRequest', ok: false });
      expect(JSON.parse(llm.toolResultsAt(1)[0]!.content).error.code).toBe('ORDER_NOT_RETURNABLE');

      for (const status of [
        OrderStatus.PAID,
        OrderStatus.PROCESSING,
        OrderStatus.SHIPPING,
        OrderStatus.DELIVERED,
      ]) {
        await http
          .patch(`/api/orders/${order.id}/status`)
          .set(auth(tokens.warehouse))
          .send({ status })
          .expect(200);
      }

      proposeReturn();
      const { body } = await ask(ticket.id, 'Khách muốn trả hàng').expect(200);
      const proposal = body.pendingActions[0];
      expect(proposal).toMatchObject({ type: 'CREATE_RETURN_REQUEST', status: 'PENDING' });
      expect(await prisma.returnRequest.count({ where: { orderId: order.id } })).toBe(0);

      await http
        .post(`/api/support/pending-actions/${proposal.id}/confirm`)
        .set(auth(tokens.support))
        .expect(200);
      const requests = await prisma.returnRequest.findMany({ where: { orderId: order.id } });
      expect(requests).toEqual([
        expect.objectContaining({
          reason: 'Tai nghe lỗi',
          createdById: ids.support,
          pendingActionId: proposal.id,
        }),
      ]);
    });
  });
});
