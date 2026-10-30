import { HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OrderStatus,
  PendingActionStatus,
  PendingActionType,
  Role,
  TicketStatus,
} from '@prisma/client';
import {
  finalAnswer,
  hang,
  ScriptedLlmProvider,
  toolCalls,
} from '../../../../test/scripted-llm.provider';
import { AppException } from '../../../common/exceptions/app.exception';
import type { EnvironmentVariables } from '../../../config/env.validation';
import type { AuthUser } from '../../auth/auth.types';
import { CatalogService } from '../../catalog/catalog.service';
import { LlmError } from '../../llm/llm.types';
import { OrderDto } from '../../orders/dto/order.response';
import { OrdersService } from '../../orders/orders.service';
import { PendingActionDto } from '../dto/pending-action.response';
import { TicketDetailDto } from '../dto/ticket.response';
import { PendingActionsService } from '../pending-actions.service';
import { TicketsService } from '../tickets.service';
import { AgentToolsService } from './agent-tools';
import { findUngroundedClaims } from './grounding';
import {
  AI_UNAVAILABLE_MESSAGE,
  parseFinalAnswer,
  SupportAgentService,
} from './support-agent.service';
import { SUPPORT_AGENT_SYSTEM_PROMPT, UNGROUNDED_REPLY } from './system-prompt';

const staff: AuthUser = { id: 'sup-1', role: Role.SUPPORT };
const TICKET_ID = '9f1f3c1e-2222-4222-8222-222222222222';

const ticket: TicketDetailDto = {
  id: TICKET_ID,
  code: 'TK-000007',
  subject: 'Đơn chưa thấy giao',
  status: TicketStatus.OPEN,
  category: null,
  categorySource: null,
  orderId: null,
  orderCode: null,
  lastMessageAt: new Date('2026-10-30T08:00:00Z'),
  createdAt: new Date('2026-10-30T08:00:00Z'),
  messages: [
    {
      id: 1,
      body: 'Đơn SF-000123 của tôi đặt 5 ngày rồi chưa thấy giao.',
      createdAt: new Date('2026-10-30T08:00:00Z'),
      author: { role: Role.CUSTOMER, fullName: 'Khách A' },
    },
  ],
};

const order: OrderDto = {
  id: '0b1f3c1e-1111-4111-8111-111111111111',
  code: 'SF-000123',
  status: OrderStatus.SHIPPING,
  totalAmount: 450_000,
  paidAt: new Date('2026-10-26T09:00:00Z'),
  createdAt: new Date('2026-10-25T10:00:00Z'),
  items: [
    {
      productId: 1,
      sku: 'SF-PK-0001',
      name: 'Chuột',
      quantity: 1,
      unitPrice: 450_000,
      lineTotal: 450_000,
    },
  ],
  shipping: null,
  statusHistory: [],
};

const pendingAction: PendingActionDto = {
  id: 'pa-1',
  type: PendingActionType.CANCEL_ORDER,
  status: PendingActionStatus.PENDING,
  summary: 'Huỷ đơn SF-000123 (hiện "Đã thanh toán"). Lý do: khách đổi ý',
  reason: 'khách đổi ý',
  orderId: order.id,
  orderCode: order.code,
  ticketId: TICKET_ID,
  ticketCode: ticket.code,
  proposedById: staff.id,
  decidedById: null,
  decidedAt: null,
  decisionNote: null,
  errorCode: null,
  createdAt: new Date(),
};

function setup(llm: ScriptedLlmProvider, config: { maxRounds?: number; timeoutMs?: number } = {}) {
  const ordersService = {
    findByRef: jest.fn().mockResolvedValue(order),
    changeStatus: jest.fn(),
  };
  const catalogService = {
    stockBySku: jest.fn().mockResolvedValue({ id: 1, sku: 'SF-PK-0001', name: 'Chuột', stock: 7 }),
  };
  const pendingActions = {
    propose: jest.fn().mockResolvedValue({ action: pendingAction, created: true }),
    confirm: jest.fn(),
  };
  const ticketsService = { findOne: jest.fn().mockResolvedValue(ticket) };
  const values: Record<string, number> = {
    AGENT_MAX_TOOL_ROUNDS: config.maxRounds ?? 5,
    AGENT_TIMEOUT_MS: config.timeoutMs ?? 5_000,
  };
  const tools = new AgentToolsService(
    ordersService as unknown as OrdersService,
    catalogService as unknown as CatalogService,
    pendingActions as unknown as PendingActionsService,
  );
  const service = new SupportAgentService(
    llm,
    tools,
    ticketsService as unknown as TicketsService,
    { get: (key: string) => values[key] } as unknown as ConfigService<EnvironmentVariables, true>,
  );
  return { service, ordersService, catalogService, pendingActions, ticketsService };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('SupportAgentService – hỏi về đơn phải gọi tool', () => {
  it('gọi getOrderStatus → service thật được gọi, kết quả gửi lại model, trả lời có căn cứ', async () => {
    const llm = new ScriptedLlmProvider([
      toolCalls({ name: 'getOrderStatus', input: { orderRef: 'SF-000123' } }),
      finalAnswer('answer', 'Đơn SF-000123 đang ở trạng thái "Đang giao", dự kiến sớm tới khách.'),
    ]);
    const { service, ordersService } = setup(llm);

    const reply = await service.ask(staff, TICKET_ID, 'Đơn của khách đang ở đâu?');

    expect(ordersService.findByRef).toHaveBeenCalledWith(staff, 'SF-000123');
    expect(reply.outcome).toBe('answered');
    expect(reply.reply).toContain('Đang giao');
    expect(reply.toolCalls).toEqual([
      { name: 'getOrderStatus', input: { orderRef: 'SF-000123' }, ok: true },
    ]);
    // Kết quả tool (dữ liệu thật) được gửi lại cho model ở vòng 2.
    const [result] = llm.toolResultsAt(1);
    expect(JSON.parse(result!.content)).toMatchObject({ code: 'SF-000123', status: 'SHIPPING' });
    expect(result!.isError).toBeFalsy();
  });

  it('trả lời trạng thái đơn mà KHÔNG gọi tool → bị nhắc lại; lặp lại → chặn (ungrounded)', async () => {
    const llm = new ScriptedLlmProvider([
      finalAnswer('answer', 'Đơn SF-000123 đang giao, khách chờ thêm 1 ngày.'),
      finalAnswer('answer', 'Đơn SF-000123 đang giao nhé.'),
    ]);
    const { service, ordersService } = setup(llm);

    const reply = await service.ask(staff, TICKET_ID, 'Đơn SF-000123 sao rồi?');

    expect(reply.outcome).toBe('ungrounded');
    expect(reply.reply).toBe(UNGROUNDED_REPLY);
    expect(reply.reply).not.toContain('đang giao');
    expect(ordersService.findByRef).not.toHaveBeenCalled();
    // Vòng 2 có lời nhắc phải tra bằng tool.
    expect(llm.requests[1]!.messages.at(-1)).toMatchObject({
      role: 'user',
      text: expect.stringContaining('getOrderStatus'),
    });
  });

  it('bị nhắc rồi gọi tool → trả lời bình thường', async () => {
    const llm = new ScriptedLlmProvider([
      finalAnswer('answer', 'Đơn đang giao.'),
      toolCalls({ name: 'getOrderStatus', input: { orderRef: 'SF-000123' } }),
      finalAnswer('answer', 'Đơn SF-000123 đang giao.'),
    ]);
    const { service } = setup(llm);

    const reply = await service.ask(staff, TICKET_ID, 'Đơn SF-000123 sao rồi?');

    expect(reply.outcome).toBe('answered');
    expect(reply.toolCalls.map((c) => c.name)).toEqual(['getOrderStatus']);
  });

  it('checkStock: nói về tồn kho chỉ sau khi tra; tra xong thì hợp lệ', async () => {
    const llm = new ScriptedLlmProvider([
      toolCalls({ name: 'checkStock', input: { sku: 'sf-pk-0001' } }),
      finalAnswer('answer', 'SF-PK-0001 còn 7 chiếc trong tồn kho.'),
    ]);
    const { service, catalogService } = setup(llm);

    const reply = await service.ask(staff, TICKET_ID, 'Chuột SF-PK-0001 còn hàng không?');

    expect(catalogService.stockBySku).toHaveBeenCalledWith('sf-pk-0001');
    expect(reply.outcome).toBe('answered');
  });
});

describe('SupportAgentService – ngoài phạm vi', () => {
  it('system prompt có luật phạm vi; model trả out_of_scope → từ chối, không tool nào chạy', async () => {
    const llm = new ScriptedLlmProvider([
      finalAnswer('out_of_scope', 'Xin lỗi, tôi chỉ hỗ trợ các nghiệp vụ của ShopFast.'),
    ]);
    const { service, ordersService, catalogService, pendingActions } = setup(llm);

    const reply = await service.ask(staff, TICKET_ID, 'Viết giúp tôi một bài thơ về mùa thu');

    expect(reply).toMatchObject({ outcome: 'out_of_scope', toolCalls: [], pendingActions: [] });
    expect(ordersService.findByRef).not.toHaveBeenCalled();
    expect(catalogService.stockBySku).not.toHaveBeenCalled();
    expect(pendingActions.propose).not.toHaveBeenCalled();

    const request = llm.requests[0]!;
    expect(request.system).toBe(SUPPORT_AGENT_SYSTEM_PROMPT);
    expect(request.system).toContain('Chỉ hỗ trợ nghiệp vụ ShopFast');
    expect(request.system).toContain('từ chối lịch sự');
    expect(request.system).toContain('chưa gọi tool');
    expect(request.tools!.map((t) => t.name)).toEqual([
      'getOrderStatus',
      'checkStock',
      'proposeCancelOrder',
      'proposeReturnRequest',
    ]);
  });

  it('nội dung ticket được bọc trong <ticket_context> (dữ liệu, không phải chỉ dẫn)', async () => {
    const llm = new ScriptedLlmProvider([finalAnswer('answer', 'Bạn cần tra đơn trước.')]);
    const { service } = setup(llm);

    await service.ask(staff, TICKET_ID, 'Tóm tắt ticket');

    const first = llm.requests[0]!.messages[0]!;
    expect(first.role).toBe('user');
    expect(first.role === 'user' && first.text).toMatch(
      /<ticket_context>[\s\S]*SF-000123 của tôi[\s\S]*<\/ticket_context>/,
    );
  });
});

describe('SupportAgentService – thao tác ghi chỉ tạo đề xuất', () => {
  it('proposeCancelOrder → PendingActionsService.propose; KHÔNG gọi changeStatus/confirm', async () => {
    const llm = new ScriptedLlmProvider([
      toolCalls({
        name: 'proposeCancelOrder',
        input: { orderRef: 'SF-000123', reason: 'khách đổi ý' },
      }),
      finalAnswer('answer', 'Đã tạo đề xuất huỷ đơn SF-000123, chờ nhân viên xác nhận.'),
    ]);
    const { service, ordersService, pendingActions } = setup(llm);

    const reply = await service.ask(staff, TICKET_ID, 'Khách muốn huỷ đơn');

    expect(pendingActions.propose).toHaveBeenCalledWith(staff, {
      type: PendingActionType.CANCEL_ORDER,
      orderRef: 'SF-000123',
      reason: 'khách đổi ý',
      ticketId: TICKET_ID,
    });
    expect(ordersService.changeStatus).not.toHaveBeenCalled();
    expect(pendingActions.confirm).not.toHaveBeenCalled();
    expect(reply.outcome).toBe('answered');
    expect(reply.pendingActions).toEqual([pendingAction]);
    const [result] = llm.toolResultsAt(1);
    expect(JSON.parse(result!.content)).toMatchObject({
      pendingActionId: 'pa-1',
      status: 'PENDING',
      note: expect.stringContaining('chưa thực thi'),
    });
  });

  it('đề xuất lặp trong một lượt (trả lại bản đang chờ) → chỉ liệt kê một lần', async () => {
    const propose = {
      name: 'proposeCancelOrder',
      input: { orderRef: 'SF-000123', reason: 'khách đổi ý' },
    };
    const llm = new ScriptedLlmProvider([
      toolCalls(propose),
      toolCalls(propose),
      finalAnswer('answer', 'Đã tạo đề xuất, chờ nhân viên xác nhận.'),
    ]);
    const { service, pendingActions } = setup(llm);
    pendingActions.propose
      .mockResolvedValueOnce({ action: pendingAction, created: true })
      .mockResolvedValueOnce({ action: pendingAction, created: false });

    const reply = await service.ask(staff, TICKET_ID, 'Huỷ đơn giúp');

    expect(reply.toolCalls).toHaveLength(2);
    expect(reply.pendingActions).toEqual([pendingAction]);
    expect(JSON.parse(llm.toolResultsAt(2)[0]!.content)).toMatchObject({ alreadyPending: true });
  });

  it('proposeReturnRequest dùng loại CREATE_RETURN_REQUEST', async () => {
    const llm = new ScriptedLlmProvider([
      toolCalls({
        name: 'proposeReturnRequest',
        input: { orderRef: 'SF-000123', reason: 'hàng lỗi' },
      }),
      finalAnswer('answer', 'Đã tạo đề xuất đổi trả, chờ xác nhận.'),
    ]);
    const { service, pendingActions } = setup(llm);

    await service.ask(staff, TICKET_ID, 'Khách muốn trả hàng');

    expect(pendingActions.propose).toHaveBeenCalledWith(
      staff,
      expect.objectContaining({ type: PendingActionType.CREATE_RETURN_REQUEST }),
    );
  });
});

describe('SupportAgentService – lỗi tool không làm hỏng lượt', () => {
  it('tool không tồn tại, input sai, AppException → isError cho model; vòng lặp tiếp tục', async () => {
    const llm = new ScriptedLlmProvider([
      toolCalls(
        { name: 'deleteAllOrders', input: {} },
        { name: 'getOrderStatus', input: { orderRef: 'không hợp lệ!' } },
        { name: 'getOrderStatus', input: { orderRef: 'SF-999999' } },
      ),
      finalAnswer('answer', 'Không tra được đơn này.'),
    ]);
    const { service, ordersService } = setup(llm);
    ordersService.findByRef.mockRejectedValue(
      new AppException(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng.'),
    );

    const reply = await service.ask(staff, TICKET_ID, 'Tra đơn giúp');

    expect(reply.outcome).toBe('answered');
    expect(reply.toolCalls.map((c) => c.ok)).toEqual([false, false, false]);
    const results = llm.toolResultsAt(1);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.isError)).toBe(true);
    expect(results.map((r) => JSON.parse(r.content).error.code)).toEqual([
      'UNKNOWN_TOOL',
      'INVALID_INPUT',
      'ORDER_NOT_FOUND',
    ]);
  });

  it('lỗi lạ trong service → INTERNAL_ERROR cho model, không lộ chi tiết', async () => {
    const llm = new ScriptedLlmProvider([
      toolCalls({ name: 'checkStock', input: { sku: 'SF-PK-0001' } }),
      finalAnswer('answer', 'Hệ thống chưa tra được, vui lòng thử lại.'),
    ]);
    const { service, catalogService } = setup(llm);
    catalogService.stockBySku.mockRejectedValue(new Error('connection reset by peer 10.0.0.5'));

    await service.ask(staff, TICKET_ID, 'Còn hàng không?');

    const [result] = llm.toolResultsAt(1);
    expect(result!.content).not.toContain('10.0.0.5');
    expect(JSON.parse(result!.content).error.code).toBe('INTERNAL_ERROR');
  });

  it('đề xuất bị từ chối nghiệp vụ (đơn không huỷ/đổi trả được) → lỗi tool, không thoát ra ngoài', async () => {
    const llm = new ScriptedLlmProvider([
      toolCalls(
        { name: 'proposeCancelOrder', input: { orderRef: 'SF-000123', reason: 'khách đổi ý' } },
        { name: 'proposeReturnRequest', input: { orderRef: 'SF-000123', reason: 'hàng lỗi' } },
      ),
      finalAnswer('answer', 'Không tạo được đề xuất cho đơn này.'),
    ]);
    const { service, pendingActions } = setup(llm);
    pendingActions.propose.mockRejectedValue(
      new AppException(
        HttpStatus.CONFLICT,
        'ORDER_NOT_CANCELLABLE',
        'Đơn đang giao, không thể huỷ.',
      ),
    );

    const reply = await service.ask(staff, TICKET_ID, 'Huỷ hoặc trả đơn giúp');

    expect(reply).toMatchObject({ outcome: 'answered', pendingActions: [] });
    expect(llm.toolResultsAt(1).map((r) => JSON.parse(r.content).error.code)).toEqual([
      'ORDER_NOT_CANCELLABLE',
      'ORDER_NOT_CANCELLABLE',
    ]);
  });
});

describe('SupportAgentService – giới hạn và lỗi LLM', () => {
  it('model gọi tool mãi → dừng đúng AGENT_MAX_TOOL_ROUNDS lần gọi, limit_reached', async () => {
    const llm = new ScriptedLlmProvider(
      Array.from({ length: 10 }, () =>
        toolCalls({ name: 'getOrderStatus', input: { orderRef: 'SF-000123' } }),
      ),
    );
    const { service } = setup(llm, { maxRounds: 3 });

    const reply = await service.ask(staff, TICKET_ID, 'Tra đơn');

    expect(llm.requests).toHaveLength(3);
    expect(reply.outcome).toBe('limit_reached');
    expect(reply.toolCalls).toHaveLength(3);
  });

  it('model treo (bỏ qua AbortSignal) → hết AGENT_TIMEOUT_MS thì 503 AI_UNAVAILABLE', async () => {
    const llm = new ScriptedLlmProvider([hang(false)]);
    const { service } = setup(llm, { timeoutMs: 50 });

    const started = Date.now();
    const error = await service.ask(staff, TICKET_ID, 'Tra đơn').catch((e: unknown) => e);

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(error).toBeInstanceOf(AppException);
    expect(error).toMatchObject({
      code: 'AI_UNAVAILABLE',
      userMessage: AI_UNAVAILABLE_MESSAGE,
    });
    expect((error as AppException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('AbortSignal được truyền cho provider và bị huỷ khi quá hạn', async () => {
    let seen: AbortSignal | undefined;
    const llm = new ScriptedLlmProvider([
      (_req, options) => {
        seen = options.signal;
        return new Promise(() => undefined);
      },
    ]);
    const { service } = setup(llm, { timeoutMs: 30 });

    await expect(service.ask(staff, TICKET_ID, 'x')).rejects.toMatchObject({
      code: 'AI_UNAVAILABLE',
    });
    expect(seen?.aborted).toBe(true);
  });

  it('provider lỗi sau khi đã tạo đề xuất → 503 kèm pendingActionIds', async () => {
    const llm = new ScriptedLlmProvider([
      toolCalls({
        name: 'proposeCancelOrder',
        input: { orderRef: 'SF-000123', reason: 'khách đổi ý' },
      }),
      new LlmError('rate_limited', '429'),
    ]);
    const { service } = setup(llm);

    await expect(service.ask(staff, TICKET_ID, 'Huỷ đơn')).rejects.toMatchObject({
      code: 'AI_UNAVAILABLE',
      details: { pendingActionIds: ['pa-1'] },
    });
  });

  it.each(['unavailable', 'refused', 'rejected', 'invalid_response'] as const)(
    'LlmError %s → 503 tiếng Việt, không lộ chi tiết provider',
    async (kind) => {
      const llm = new ScriptedLlmProvider([new LlmError(kind, 'secret upstream detail')]);
      const { service } = setup(llm);

      const error = (await service
        .ask(staff, TICKET_ID, 'x')
        .catch((e: unknown) => e)) as AppException;

      expect(error.code).toBe('AI_UNAVAILABLE');
      expect(error.userMessage).not.toContain('secret');
    },
  );

  it('lỗi không phải của LLM (ticket không tồn tại…) được ném nguyên', async () => {
    const llm = new ScriptedLlmProvider([]);
    const { service, ticketsService } = setup(llm);
    const notFound = new AppException(
      HttpStatus.NOT_FOUND,
      'TICKET_NOT_FOUND',
      'Không tìm thấy ticket.',
    );
    ticketsService.findOne.mockRejectedValue(notFound);

    await expect(service.ask(staff, TICKET_ID, 'x')).rejects.toBe(notFound);
    expect(llm.requests).toHaveLength(0);
  });
});

describe('parseFinalAnswer', () => {
  it('JSON đúng schema', () => {
    expect(parseFinalAnswer(finalAnswer('out_of_scope', ' Xin lỗi '))).toEqual({
      kind: 'out_of_scope',
      reply: 'Xin lỗi',
    });
  });

  it('không phải JSON → coi text là câu trả lời', () => {
    expect(parseFinalAnswer({ text: ' Chào bạn ', toolCalls: [], json: null })).toEqual({
      kind: 'answer',
      reply: 'Chào bạn',
    });
  });

  it('kind lạ → coi là answer với text gốc', () => {
    expect(
      parseFinalAnswer({ text: 'x', toolCalls: [], json: { kind: 'execute', reply: 'y' } }),
    ).toEqual({ kind: 'answer', reply: 'x' });
  });
});

describe('findUngroundedClaims', () => {
  const none = { toolOutputs: [], succeededTools: new Set<string>(), context: '' };

  it('mã đơn/SKU không có trong tool hay ngữ cảnh → vi phạm', () => {
    expect(findUngroundedClaims('Đơn SF-000999 và SF-DT-0002', none)).toEqual([
      { kind: 'order_code', value: 'SF-000999' },
      { kind: 'sku', value: 'SF-DT-0002' },
    ]);
  });

  it('nhắc lại mã có trong câu hỏi là hợp lệ, nêu trạng thái thì không', () => {
    const evidence = { ...none, context: 'Đơn SF-000123 sao rồi?' };
    expect(findUngroundedClaims('Tôi cần tra đơn SF-000123 trước.', evidence)).toEqual([]);
    expect(findUngroundedClaims('Đơn SF-000123 đã thanh toán.', evidence)).toEqual([
      { kind: 'order_status', value: 'đã thanh toán' },
    ]);
  });

  it('trạng thái có trong kết quả tool → hợp lệ (kể cả mã enum)', () => {
    const evidence = {
      toolOutputs: ['{"status":"SHIPPING","statusLabel":"Đang giao"}'],
      succeededTools: new Set(['getOrderStatus']),
      context: '',
    };
    expect(findUngroundedClaims('Đơn đang giao (SHIPPING).', evidence)).toEqual([]);
    expect(findUngroundedClaims('Đơn đã giao.', evidence)).toEqual([
      { kind: 'order_status', value: 'đã giao' },
    ]);
  });

  it('nói tồn kho mà chưa checkStock → vi phạm', () => {
    expect(findUngroundedClaims('Sản phẩm này còn hàng.', none)).toEqual([
      { kind: 'stock', value: 'còn hàng' },
    ]);
  });
});
