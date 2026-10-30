import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderDetail } from '../orders/my-orders-api';
import type {
  AssistantReply,
  PendingAction,
  QueuePage,
  QueueTicket,
  StaffTicketDetail,
} from '../support-console/console-api';
import { apiError, fakeApi, json, loginAs, type FakeHandler } from '../test/fake-api';
import { renderPage } from '../test/render';
import { SupportConsolePage } from './SupportConsolePage';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const MISSING = '44444444-4444-4444-8444-444444444444';
const ORDER = '55555555-5555-4555-8555-555555555555';
const PA = '66666666-6666-4666-8666-666666666666';

const customer = { id: 'c1', fullName: 'Nguyễn Văn Minh', email: 'minh@example.com' };
const T1_ROW: QueueTicket = {
  id: T1,
  code: 'TK-000012',
  subject: 'Khách yêu cầu huỷ đơn do đặt nhầm màu',
  status: 'OPEN',
  category: 'DON_HANG',
  categorySource: 'LLM',
  orderId: ORDER,
  orderCode: 'SF-000123',
  lastMessageAt: new Date().toISOString(),
  createdAt: '2024-10-24T07:40:00.000Z',
  customer,
};
const T2_ROW: QueueTicket = {
  ...T1_ROW,
  id: T2,
  code: 'TK-000011',
  subject: 'Hỏi thời gian giao tai nghe',
  status: 'ANSWERED',
  category: 'VAN_CHUYEN',
  orderId: null,
  orderCode: null,
  customer: { id: 'c2', fullName: 'Trần Thị Lan', email: 'lan@example.com' },
};
const T1_DETAIL: StaffTicketDetail = {
  ...T1_ROW,
  messages: [
    {
      id: 1,
      body: 'Nhờ hỗ trợ huỷ đơn SF-000123 giúp mình.',
      createdAt: '2024-10-24T07:40:00.000Z',
      author: { role: 'CUSTOMER', fullName: 'Nguyễn Văn Minh' },
    },
    {
      id: 2,
      body: 'Dạ em đang kiểm tra ạ.',
      createdAt: '2024-10-24T07:42:00.000Z',
      author: { role: 'SUPPORT', fullName: 'Mai Linh' },
    },
  ],
};
const ORDER_DETAIL: OrderDetail = {
  id: ORDER,
  code: 'SF-000123',
  status: 'PROCESSING',
  totalAmount: 14_360_000,
  paidAt: null,
  createdAt: '2024-10-24T07:35:00.000Z',
  items: [],
  statusHistory: [],
};
const PROPOSAL: PendingAction = {
  id: PA,
  type: 'CANCEL_ORDER',
  status: 'PENDING',
  summary: 'Huỷ đơn SF-000123 (Đang xử lý) và hoàn kho.',
  reason: 'Khách đặt nhầm màu',
  orderId: ORDER,
  orderCode: 'SF-000123',
  ticketId: T1,
  ticketCode: 'TK-000012',
  decisionNote: null,
  errorCode: null,
  createdAt: new Date().toISOString(),
};
const COUNTS = { OPEN: 7, ANSWERED: 3, CLOSED: 12 };

function queuePage(items: QueueTicket[]): QueuePage {
  return {
    items,
    meta: { page: 1, limit: 20, total: items.length, totalPages: 1 },
    statusCounts: COUNTS,
  };
}
const pendingPage = (items: PendingAction[]) =>
  json({ items, meta: { page: 1, limit: 20, total: items.length, totalPages: 1 } });

function viewport(desktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: desktop })),
  );
}

function setup(route = '/quan-tri/cskh/ticket', routes: Record<string, FakeHandler> = {}) {
  const api = fakeApi({
    'GET /support/tickets': () => json(queuePage([T1_ROW, T2_ROW])),
    [`GET /support/tickets/${T1}`]: () => json(T1_DETAIL),
    [`GET /support/tickets/${T2}`]: () => json({ ...T2_ROW, messages: [] }),
    [`GET /orders/${ORDER}`]: () => json(ORDER_DETAIL),
    'GET /support/pending-actions': () => pendingPage([]),
    ...routes,
  });
  const view = renderPage(<SupportConsolePage />, { route, path: '/quan-tri/cskh/ticket' });
  return {
    ...view,
    api,
    lastQueue: () => Object.fromEntries(api.to('GET /support/tickets').at(-1)!.query),
  };
}

const queue = () => screen.findByRole('list', { name: 'Hàng đợi ticket' });
const ticketPane = () => screen.findByRole('region', { name: 'Ticket #TK-000012' });
const copilot = () => screen.findByRole('region', { name: 'ShopFast Copilot' });

async function askCopilot(user: ReturnType<typeof setup>['user'], question: string) {
  const panel = await copilot();
  await user.type(within(panel).getByRole('textbox', { name: 'Câu hỏi cho Copilot' }), question);
  await user.click(within(panel).getByRole('button', { name: 'Hỏi Copilot' }));
  return panel;
}

describe('SupportConsolePage', () => {
  beforeEach(() => {
    loginAs('SUPPORT');
    viewport(true);
  });

  it('hàng đợi + số đếm; tự mở ticket đầu: khách, email, tin hai phía, đơn liên quan', async () => {
    const { location, lastQueue } = setup();
    expect(screen.getByRole('status', { name: 'Đang tải hàng đợi' })).toBeInTheDocument();
    const list = await queue();
    const first = within(list).getByRole('button', { name: /#TK-000012/ });
    expect(first).toHaveTextContent('Nguyễn Văn Minh');
    expect(first).toHaveTextContent('Đơn hàng');
    expect(within(list).getByRole('button', { name: /#TK-000011/ })).toHaveTextContent(
      'Trần Thị Lan',
    );
    expect(lastQueue()).toMatchObject({ status: 'OPEN', page: '1', limit: '20' });
    expect(screen.getByRole('tab', { name: 'Chờ xử lý 7' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Tất cả 22' })).toBeInTheDocument();
    expect(screen.getByText('7 ticket chờ xử lý')).toBeInTheDocument();

    await waitFor(() => expect(location()).toBe(`/quan-tri/cskh/ticket?ticket=${T1}`));
    const pane = await ticketPane();
    expect(within(pane).getByRole('link', { name: 'minh@example.com' })).toBeInTheDocument();
    expect(
      within(pane).getByRole('article', { name: 'Tin nhắn của Nguyễn Văn Minh' }),
    ).toHaveTextContent('Nhờ hỗ trợ huỷ đơn');
    expect(
      within(pane).getByRole('article', { name: 'Tin nhắn của Mai Linh (CSKH)' }),
    ).toBeInTheDocument();
    const order = within(pane).getByRole('group', { name: 'Đơn hàng liên quan' });
    expect(order).toHaveTextContent('#SF-000123');
    expect(await within(order).findByText('Đang xử lý')).toBeInTheDocument();
    expect(order).toHaveTextContent('14.360.000');
    expect(await screen.findByText(/Chưa có đề xuất nào/)).toBeInTheDocument();
  });

  it('lọc: chip nhóm → category, tab → status, tìm → q; từ khoá quá dài báo lỗi', async () => {
    const { user, location, lastQueue } = setup(`/quan-tri/cskh/ticket?ticket=${T1}`);
    await queue();

    await user.click(screen.getByRole('button', { name: 'Vận chuyển & Giao hàng' }));
    expect(location()).toBe(`/quan-tri/cskh/ticket?category=VAN_CHUYEN&ticket=${T1}`);
    await waitFor(() => expect(lastQueue()).toMatchObject({ category: 'VAN_CHUYEN' }));

    await user.click(screen.getByRole('tab', { name: /Đã trả lời/ }));
    await waitFor(() =>
      expect(lastQueue()).toMatchObject({ status: 'ANSWERED', category: 'VAN_CHUYEN' }),
    );

    const search = screen.getByRole('searchbox', { name: 'Tìm ticket' });
    await user.click(search);
    await user.paste('a'.repeat(101));
    await user.keyboard('{Enter}');
    expect(screen.getByText('Từ khoá tối đa 100 ký tự.')).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'SF-000123{Enter}');
    await waitFor(() => expect(lastQueue()).toMatchObject({ q: 'SF-000123' }));
  });

  it('phản hồi khách: rỗng báo lỗi; gửi đúng body rồi xoá ô nhập', async () => {
    const reply = vi.fn<FakeHandler>((req) =>
      json(
        {
          ...T1_DETAIL,
          status: 'ANSWERED',
          messages: [
            ...T1_DETAIL.messages,
            {
              id: 3,
              body: (req.body as { body: string }).body,
              createdAt: new Date().toISOString(),
              author: { role: 'SUPPORT', fullName: 'Mai Linh' },
            },
          ],
        },
        201,
      ),
    );
    const { user } = setup(`/quan-tri/cskh/ticket?ticket=${T1}`, {
      [`POST /support/tickets/${T1}/messages`]: reply,
    });
    const pane = await ticketPane();
    const box = within(pane).getByRole('textbox', { name: 'Nội dung phản hồi' });
    await user.click(within(pane).getByRole('button', { name: 'Gửi phản hồi' }));
    expect(within(pane).getByText('Vui lòng nhập nội dung tin nhắn.')).toBeInTheDocument();
    expect(reply).not.toHaveBeenCalled();

    await user.type(box, ' Em đã gửi đề xuất huỷ đơn ạ ');
    await user.click(within(pane).getByRole('button', { name: 'Gửi phản hồi' }));
    await waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    expect(reply.mock.calls[0]![0].body).toEqual({ body: 'Em đã gửi đề xuất huỷ đơn ạ' });
    await waitFor(() => expect(box).toHaveValue(''));
    expect(within(pane).getByText('Em đã gửi đề xuất huỷ đơn ạ')).toBeInTheDocument();
  });

  it('đóng / mở lại ticket và đổi nhóm bằng PATCH', async () => {
    const patch = vi.fn<FakeHandler>((req) => {
      const change = req.body as { status?: string; category?: string };
      return json({ ...T1_DETAIL, ...change, ...(change.category && { categorySource: 'STAFF' }) });
    });
    const { user } = setup(`/quan-tri/cskh/ticket?ticket=${T1}`, {
      [`PATCH /support/tickets/${T1}`]: patch,
    });
    const pane = await ticketPane();

    await user.click(within(pane).getByRole('button', { name: 'Đóng ticket' }));
    await waitFor(() => expect(patch.mock.calls[0]![0].body).toEqual({ status: 'CLOSED' }));
    expect(await screen.findByText('Đã đóng ticket TK-000012')).toBeInTheDocument();
    expect(
      within(pane).queryByRole('textbox', { name: 'Nội dung phản hồi' }),
    ).not.toBeInTheDocument();

    await user.click(within(pane).getByRole('button', { name: 'Mở lại ticket' }));
    await waitFor(() => expect(patch.mock.calls[1]![0].body).toEqual({ status: 'OPEN' }));
    expect(
      await within(pane).findByRole('textbox', { name: 'Nội dung phản hồi' }),
    ).toBeInTheDocument();

    await user.selectOptions(
      within(pane).getByRole('combobox', { name: 'Nhóm vấn đề' }),
      'DOI_TRA',
    );
    await waitFor(() => expect(patch.mock.calls[2]![0].body).toEqual({ category: 'DOI_TRA' }));
  });

  it('Copilot: validate; hỏi → chip tool call + câu trả lời; đề xuất mới hiện ra', async () => {
    let proposals: PendingAction[] = [];
    const answer: AssistantReply = {
      outcome: 'answered',
      reply: 'Đơn SF-000123 đang xử lý, có thể huỷ. Em đã tạo đề xuất huỷ.',
      toolCalls: [
        { name: 'getOrderStatus', input: { orderRef: 'SF-000123' }, ok: true },
        { name: 'checkStock', input: { sku: 'IP15-128' }, ok: false },
        { name: 'proposeCancelOrder', input: { orderRef: 'SF-000123', reason: 'x' }, ok: true },
      ],
      pendingActions: [PROPOSAL],
    };
    const assistant = vi.fn<FakeHandler>(() => {
      proposals = [PROPOSAL];
      return json(answer);
    });
    const { user } = setup(`/quan-tri/cskh/ticket?ticket=${T1}`, {
      [`POST /support/tickets/${T1}/assistant`]: assistant,
      'GET /support/pending-actions': (req) => {
        expect(Object.fromEntries(req.query)).toMatchObject({ status: 'PENDING', ticketId: T1 });
        return pendingPage(proposals);
      },
    });
    const panel = await copilot();
    const input = within(panel).getByRole('textbox', { name: 'Câu hỏi cho Copilot' });

    await user.click(within(panel).getByRole('button', { name: 'Hỏi Copilot' }));
    expect(within(panel).getByText('Vui lòng nhập câu hỏi cho Copilot.')).toBeInTheDocument();
    await user.click(input);
    await user.paste('a'.repeat(2001));
    await user.keyboard('{Enter}');
    expect(within(panel).getByText('Câu hỏi tối đa 2.000 ký tự.')).toBeInTheDocument();
    expect(assistant).not.toHaveBeenCalled();
    await user.clear(input);

    await askCopilot(user, 'Khách muốn huỷ đơn, kiểm tra giúp');
    await waitFor(() => expect(assistant).toHaveBeenCalledTimes(1));
    expect(assistant.mock.calls[0]![0].body).toEqual({
      question: 'Khách muốn huỷ đơn, kiểm tra giúp',
    });

    const reply = await within(panel).findByRole('article', { name: 'Trả lời của Copilot' });
    expect(reply).toHaveTextContent('Em đã tạo đề xuất huỷ');
    const tools = within(reply).getByRole('list', { name: 'Công cụ đã dùng' });
    expect(within(tools).getByText('Tra cứu trạng thái đơn: SF-000123')).toBeInTheDocument();
    expect(within(tools).getByText('Kiểm tra tồn kho: IP15-128 – lỗi')).toBeInTheDocument();
    expect(within(tools).getByText('Đề xuất huỷ đơn: SF-000123')).toBeInTheDocument();
    expect(input).toHaveValue('');

    expect(
      await within(panel).findByRole('article', { name: 'Đề xuất: Huỷ đơn SF-000123' }),
    ).toHaveTextContent('Cần nhân viên xác nhận trước khi thực hiện');
  });

  it('Copilot lỗi 503 AI_UNAVAILABLE → thông điệp tiếng Việt, "AI tạm ngưng", hỏi lại đúng câu', async () => {
    let fail = true;
    const assistant = vi.fn<FakeHandler>(() =>
      fail
        ? apiError(
            503,
            'AI_UNAVAILABLE',
            'Trợ lý AI tạm thời không khả dụng, vui lòng thử lại sau.',
          )
        : json({
            outcome: 'ungrounded',
            reply: 'Chưa xác minh được.',
            toolCalls: [],
            pendingActions: [],
          }),
    );
    const { user } = setup(`/quan-tri/cskh/ticket?ticket=${T1}`, {
      [`POST /support/tickets/${T1}/assistant`]: assistant,
    });
    const panel = await askCopilot(user, 'Đơn giao chưa?');
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'Trợ lý AI tạm thời không khả dụng',
    );
    expect(within(panel).getByText('AI tạm ngưng')).toBeInTheDocument();

    fail = false;
    await user.click(within(panel).getByRole('button', { name: 'Hỏi lại' }));
    await waitFor(() => expect(assistant).toHaveBeenCalledTimes(2));
    expect(assistant.mock.calls[1]![0].body).toEqual({ question: 'Đơn giao chưa?' });
    expect(
      await within(panel).findByText('Đã chặn – thông tin chưa được kiểm chứng'),
    ).toBeInTheDocument();
    expect(within(panel).getByText('Sẵn sàng')).toBeInTheDocument();
  });

  it('xác nhận đề xuất: ghi chú quá dài báo lỗi; gửi kèm note; tải lại đề xuất', async () => {
    let proposals = [PROPOSAL];
    const confirm = vi.fn<FakeHandler>(() => {
      proposals = [];
      return json({ ...PROPOSAL, status: 'EXECUTED' });
    });
    const { user, api } = setup(`/quan-tri/cskh/ticket?ticket=${T1}`, {
      'GET /support/pending-actions': () => pendingPage(proposals),
      [`POST /support/pending-actions/${PA}/confirm`]: confirm,
    });
    const card = await screen.findByRole('article', { name: 'Đề xuất: Huỷ đơn SF-000123' });
    await user.click(within(card).getByRole('button', { name: 'Xác nhận' }));
    const dialog = screen.getByRole('dialog', { name: 'Xác nhận huỷ đơn #SF-000123?' });
    const note = within(dialog).getByRole('textbox', { name: /Ghi chú/ });
    await user.click(note);
    await user.paste('a'.repeat(501));
    await user.click(within(dialog).getByRole('button', { name: 'Xác nhận thực hiện' }));
    expect(within(dialog).getByText('Ghi chú tối đa 500 ký tự.')).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();

    await user.clear(note);
    await user.type(note, 'Khách xác nhận qua chat');
    await user.click(within(dialog).getByRole('button', { name: 'Xác nhận thực hiện' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0]![0].body).toEqual({ note: 'Khách xác nhận qua chat' });
    expect(await screen.findByText('Đã thực hiện: Huỷ đơn #SF-000123')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText(/Chưa có đề xuất nào/)).toBeInTheDocument();
    expect(api.to(`GET /orders/${ORDER}`).length).toBeGreaterThanOrEqual(2);
  });

  it('từ chối đề xuất → POST /reject; đề xuất đã xử lý (409) → toast lỗi và tải lại', async () => {
    const reject = vi.fn<FakeHandler>(() =>
      apiError(409, 'PENDING_ACTION_DECIDED', 'Đề xuất đã được xử lý trước đó.'),
    );
    const { user, api } = setup(`/quan-tri/cskh/ticket?ticket=${T1}`, {
      'GET /support/pending-actions': () => pendingPage([PROPOSAL]),
      [`POST /support/pending-actions/${PA}/reject`]: reject,
    });
    const card = await screen.findByRole('article', { name: 'Đề xuất: Huỷ đơn SF-000123' });
    const before = api.to('GET /support/pending-actions').length;
    await user.click(within(card).getByRole('button', { name: 'Từ chối' }));
    const dialog = screen.getByRole('dialog', { name: 'Từ chối đề xuất?' });
    await user.click(within(dialog).getByRole('button', { name: 'Từ chối đề xuất' }));

    await waitFor(() => expect(reject).toHaveBeenCalledTimes(1));
    expect(reject.mock.calls[0]![0].body).toEqual({});
    expect(await screen.findByText('Đề xuất đã được xử lý trước đó.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(api.to('GET /support/pending-actions').length).toBeGreaterThan(before),
    );
  });

  it('hàng đợi rỗng; lỗi tải hàng đợi → "Thử lại"', async () => {
    let fail = true;
    const { user } = setup('/quan-tri/cskh/ticket', {
      'GET /support/tickets': () =>
        fail ? apiError(503, 'SERVICE_UNAVAILABLE', 'Hệ thống đang bận.') : json(queuePage([])),
    });
    expect(await screen.findByText('Không tải được hàng đợi')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Không có ticket chờ xử lý')).toBeInTheDocument();
    expect(screen.getByText('Chọn một ticket trong hàng đợi')).toBeInTheDocument();
  });

  it('lọc không khớp → "Xoá bộ lọc"; ticket không tồn tại → 404', async () => {
    const { user, location } = setup(`/quan-tri/cskh/ticket?category=KHAC&ticket=${MISSING}`, {
      'GET /support/tickets': (req) => json(queuePage(req.query.get('category') ? [] : [T1_ROW])),
    });
    expect(await screen.findByText('Không có ticket phù hợp')).toBeInTheDocument();
    expect(await screen.findByText('Không tìm thấy ticket')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'ShopFast Copilot' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Xoá bộ lọc' }));
    await waitFor(() => expect(location()).toBe(`/quan-tri/cskh/ticket?ticket=${T1}`));
  });

  it('mobile: không tự mở ticket; chọn ticket rồi chuyển sang Copilot, quay lại hàng đợi', async () => {
    viewport(false);
    const { user, location, api } = setup();
    const item = within(await queue()).getByRole('button', { name: /#TK-000012/ });
    expect(location()).toBe('/quan-tri/cskh/ticket');
    expect(api.to(`GET /support/tickets/${T1}`)).toHaveLength(0);

    await user.click(item);
    await ticketPane();
    await user.click(screen.getByRole('tab', { name: 'Copilot' }));
    expect(screen.getByRole('tab', { name: 'Copilot' })).toHaveAttribute('aria-selected', 'true');
    expect(await copilot()).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hàng đợi' }));
    expect(location()).toBe('/quan-tri/cskh/ticket');
  });
});
