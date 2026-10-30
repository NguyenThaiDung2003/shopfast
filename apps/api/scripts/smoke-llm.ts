/**
 * Thử nhanh F06 với LLM THẬT (ADR-0011) – chạy tay, không chạy trong CI (tốn tiền gọi API).
 *
 *   # .env: LLM_PROVIDER=anthropic|openai, LLM_API_KEY=..., (LLM_MODEL=...)
 *   docker compose up -d --build && docker compose exec api npx prisma db seed
 *   pnpm --filter @shopfast/api smoke:llm
 *
 * Các bước:
 *   1. Khách tạo ticket → chờ worker phân loại (category khác null, nguồn LLM).
 *   2. Nhân viên hỏi trợ lý về đơn của ticket → kỳ vọng gọi getOrderStatus.
 *   3. Hỏi câu ngoài phạm vi → kỳ vọng out_of_scope.
 *   4. Nhờ huỷ đơn → kỳ vọng chỉ có đề xuất PENDING, đơn KHÔNG đổi trạng thái.
 * Không xác nhận đề xuất (để bạn tự thử qua Swagger /docs).
 */
const BASE_URL = process.env.SMOKE_URL ?? 'http://127.0.0.1:3000';
const PASSWORD = process.env.SMOKE_PASSWORD ?? process.env.SEED_USER_PASSWORD;
/** Bỏ trống: dò customer01..customer20 của seed, lấy khách đầu tiên có đơn còn huỷ được. */
const CUSTOMER = process.env.SMOKE_CUSTOMER_EMAIL;
const CANCELLABLE = ['PENDING_PAYMENT', 'PAID', 'PROCESSING'];
const SUPPORT = process.env.SMOKE_SUPPORT_EMAIL ?? 'support01@shopfast.local';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(method: string, path: string, token?: string, body?: unknown): Promise<Json> {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function login(email: string): Promise<string> {
  return (await call('POST', '/auth/login', undefined, { email, password: PASSWORD })).accessToken;
}

/** Khách có đơn còn huỷ được – để bước 4 kiểm thật việc đề xuất không tự huỷ đơn. */
async function findCancellableOrder(): Promise<{ customer: string; order: Json }> {
  const emails = CUSTOMER
    ? [CUSTOMER]
    : Array.from(
        { length: 20 },
        (_, i) => `customer${String(i + 1).padStart(2, '0')}@shopfast.local`,
      );
  for (const email of emails) {
    const customer = await login(email);
    const orders = await call('GET', '/orders/me?limit=50', customer);
    const order = orders.items.find((o: Json) => CANCELLABLE.includes(o.status));
    if (order) {
      console.log(`Dùng ${email}, đơn ${order.code} (${order.status})`);
      return { customer, order };
    }
  }
  throw new Error('Không tìm thấy khách nào có đơn còn huỷ được – chạy seed trước.');
}

function check(label: string, ok: boolean, detail: unknown): void {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
  console.log(`     ${JSON.stringify(detail)}`);
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  if (!PASSWORD)
    throw new Error('Cần SEED_USER_PASSWORD (hoặc SMOKE_PASSWORD) để đăng nhập tài khoản seed.');
  const support = await login(SUPPORT);
  const { customer, order } = await findCancellableOrder();

  // 1. Phân loại
  const ticket = await call('POST', '/support/tickets', customer, {
    subject: 'Đơn chưa giao',
    message: `Đơn ${order.code} của tôi đặt lâu rồi mà vẫn chưa thấy giao, shop kiểm tra giúp.`,
    orderId: order.id,
  });
  let classified: Json = ticket;
  for (let i = 0; i < 30 && !classified.category; i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    classified = await call('GET', `/support/tickets/${ticket.id}`, support);
  }
  check('Phân loại ticket bằng LLM', classified.categorySource === 'LLM', {
    code: ticket.code,
    category: classified.category,
    source: classified.categorySource,
  });

  // 2. Hỏi về đơn
  const started = Date.now();
  const status = await call('POST', `/support/tickets/${ticket.id}/assistant`, support, {
    question: 'Đơn của khách hiện đang ở trạng thái nào?',
  });
  check(
    'Hỏi đơn → gọi getOrderStatus',
    status.toolCalls.some((c: Json) => c.name === 'getOrderStatus' && c.ok),
    {
      ms: Date.now() - started,
      outcome: status.outcome,
      reply: status.reply,
      toolCalls: status.toolCalls,
    },
  );

  // 3. Ngoài phạm vi
  const offTopic = await call('POST', `/support/tickets/${ticket.id}/assistant`, support, {
    question: 'Viết giúp tôi một bài thơ về mùa thu Hà Nội.',
  });
  check('Câu ngoài phạm vi → từ chối', offTopic.outcome === 'out_of_scope', {
    outcome: offTopic.outcome,
    reply: offTopic.reply,
  });

  // 4. Đề xuất ghi
  const cancel = await call('POST', `/support/tickets/${ticket.id}/assistant`, support, {
    question: 'Khách muốn huỷ đơn này vì chờ lâu quá, xử lý giúp mình.',
  });
  const after = await call('GET', `/orders/${order.id}`, support);
  check('Huỷ đơn → chỉ tạo đề xuất, đơn chưa đổi', after.status === order.status, {
    orderStatus: `${order.status} → ${after.status}`,
    pendingActions: cancel.pendingActions.map((a: Json) => ({
      id: a.id,
      status: a.status,
      summary: a.summary,
    })),
    toolCalls: cancel.toolCalls,
    reply: cancel.reply,
  });
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
