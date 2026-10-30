import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyOrderPage } from '../orders/my-orders-api';
import type { MyTicketPage, Ticket, TicketDetail } from '../support/tickets-api';
import { apiError, fakeApi, json, loginAs, type FakeHandler } from '../test/fake-api';
import { renderPage } from '../test/render';
import { SupportPage } from './SupportPage';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const NEW = '33333333-3333-4333-8333-333333333333';
const MISSING = '44444444-4444-4444-8444-444444444444';
const ORDER = '55555555-5555-4555-8555-555555555555';

const OPEN: Ticket = {
  id: T1,
  code: 'TK-000012',
  subject: 'Kiểm tra thời gian giao hàng đơn SF-000123',
  status: 'OPEN',
  category: 'VAN_CHUYEN',
  categorySource: 'LLM',
  orderId: ORDER,
  orderCode: 'SF-000123',
  lastMessageAt: '2024-10-24T08:20:00.000Z',
  createdAt: '2024-10-24T07:40:00.000Z',
};
const CLOSED: Ticket = {
  ...OPEN,
  id: T2,
  code: 'TK-000007',
  subject: 'Đổi phương thức thanh toán sau khi đặt hàng',
  status: 'CLOSED',
  category: null,
  categorySource: null,
  orderId: null,
  orderCode: null,
};

const customerMsg = (id: number, body: string) => ({
  id,
  body,
  createdAt: '2024-10-24T07:40:00.000Z',
  author: { role: 'CUSTOMER' as const, fullName: 'Nguyễn Văn Minh' },
});
const DETAIL_OPEN: TicketDetail = {
  ...OPEN,
  messages: [
    customerMsg(1, 'Bưu tá đã lấy hàng chưa ạ?'),
    {
      id: 2,
      body: 'Dạ kiện hàng đã bàn giao cho đơn vị vận chuyển ạ.',
      createdAt: '2024-10-24T07:52:00.000Z',
      author: { role: 'SUPPORT', fullName: 'Mai Linh' },
    },
  ],
};
const DETAIL_CLOSED: TicketDetail = { ...CLOSED, messages: [customerMsg(3, 'Đổi sang VNPay')] };

const COUNTS = { OPEN: 1, ANSWERED: 1, CLOSED: 2 };

function ticketPage(items: Ticket[], total = items.length): MyTicketPage {
  return {
    items,
    meta: { page: 1, limit: 10, total, totalPages: Math.max(1, Math.ceil(total / 10)) },
    statusCounts: COUNTS,
  };
}

const ORDERS: MyOrderPage = {
  items: [
    {
      id: ORDER,
      code: 'SF-000123',
      status: 'SHIPPING',
      totalAmount: 1_000_000,
      paidAt: null,
      createdAt: '2024-10-24T07:35:00.000Z',
      items: [
        { productId: 1, sku: 'A', name: 'Tai nghe', quantity: 1, unitPrice: 1, lineTotal: 1 },
        { productId: 2, sku: 'B', name: 'Cáp', quantity: 1, unitPrice: 1, lineTotal: 1 },
      ],
    },
  ],
  meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
  statusCounts: {
    PENDING_PAYMENT: 0,
    PAID: 0,
    PROCESSING: 0,
    SHIPPING: 1,
    DELIVERED: 0,
    CANCELLED: 0,
  },
};

/** Desktop (≥ lg) mở sẵn ticket đầu tiên; mobile thì không. */
function viewport(desktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: desktop })),
  );
}

function setup(route = '/ho-tro', routes: Record<string, FakeHandler> = {}) {
  const api = fakeApi({
    'GET /support/tickets/me': () => json(ticketPage([OPEN, CLOSED], 4)),
    [`GET /support/tickets/${T1}`]: () => json(DETAIL_OPEN),
    [`GET /support/tickets/${T2}`]: () => json(DETAIL_CLOSED),
    'GET /orders/me': () => json(ORDERS),
    ...routes,
  });
  const view = renderPage(<SupportPage />, { route, path: '/ho-tro' });
  return {
    ...view,
    api,
    lastListQuery: () => Object.fromEntries(api.to('GET /support/tickets/me').at(-1)!.query),
  };
}

const list = () => screen.getByRole('list', { name: 'Yêu cầu hỗ trợ' });
const conversation = () => screen.getByRole('region', { name: /^Hội thoại yêu cầu/ });

describe('SupportPage', () => {
  beforeEach(() => {
    loginAs('CUSTOMER');
    viewport(true);
  });

  it('danh sách + số đếm; desktop tự mở ticket đầu tiên với tin của khách và CSKH', async () => {
    const { location } = setup();
    expect(screen.getByRole('status', { name: 'Đang tải danh sách yêu cầu' })).toBeInTheDocument();

    const first = await within(
      await screen.findByRole('list', { name: 'Yêu cầu hỗ trợ' }),
    ).findByRole('button', { name: /#TK-000012/ });
    expect(first).toHaveTextContent('Đang xử lý');
    expect(first).toHaveTextContent('Vận chuyển & Giao hàng');
    expect(first).toHaveTextContent('Phân loại AI');
    expect(first).toHaveTextContent('Đơn #SF-000123');
    const second = within(list()).getByRole('button', { name: /#TK-000007/ });
    expect(second).toHaveTextContent('Đã đóng');
    expect(second).toHaveTextContent('Không gắn đơn');

    expect(screen.getByText('4 phiếu')).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: 'Lọc yêu cầu theo trạng thái' });
    expect(within(tabs).getByRole('tab', { name: 'Tất cả 4' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(tabs).getByRole('tab', { name: 'Đang xử lý 2' })).toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: 'Đã đóng 2' })).toBeInTheDocument();

    await waitFor(() => expect(location()).toBe(`/ho-tro?ticket=${T1}`));
    const chat = await screen.findByRole('region', { name: 'Hội thoại yêu cầu #TK-000012' });
    expect(within(chat).getByRole('heading', { name: OPEN.subject })).toBeInTheDocument();
    expect(within(chat).getByRole('article', { name: 'Tin nhắn của bạn' })).toHaveTextContent(
      'Bưu tá đã lấy hàng chưa ạ?',
    );
    const staff = within(chat).getByRole('article', { name: 'Tin nhắn của Mai Linh' });
    expect(staff).toHaveTextContent('Chuyên viên CSKH');
    expect(
      within(chat).getByText(/AI phân loại tự động vào nhóm \[Vận chuyển/),
    ).toBeInTheDocument();
    expect(within(chat).getByRole('link', { name: /Đơn hàng: #SF-000123/ })).toHaveAttribute(
      'href',
      `/don-hang/${ORDER}`,
    );
    expect(first).toHaveAttribute('aria-current', 'true');
  });

  it('tab "Đang xử lý" → status=OPEN,ANSWERED; tìm kiếm ghi q, từ khoá quá dài báo lỗi', async () => {
    const { user, location, lastListQuery } = setup(`/ho-tro?ticket=${T1}`);
    await screen.findByRole('list', { name: 'Yêu cầu hỗ trợ' });

    await user.click(screen.getByRole('tab', { name: /Đang xử lý/ }));
    expect(location()).toBe(`/ho-tro?tab=open&ticket=${T1}`);
    await waitFor(() =>
      expect(lastListQuery()).toMatchObject({ status: 'OPEN,ANSWERED', page: '1' }),
    );

    const search = screen.getByRole('searchbox', { name: 'Tìm theo mã ticket hoặc tiêu đề' });
    await user.click(search);
    await user.paste('a'.repeat(101));
    await user.click(screen.getByRole('button', { name: 'Tìm' }));
    expect(screen.getByText('Từ khoá tối đa 100 ký tự.')).toBeInTheDocument();
    expect(location()).toBe(`/ho-tro?tab=open&ticket=${T1}`);

    await user.clear(search);
    await user.type(search, ' tk-000012 {Enter}');
    expect(location()).toBe(`/ho-tro?tab=open&q=tk-000012&ticket=${T1}`);
    await waitFor(() => expect(lastListQuery()).toMatchObject({ q: 'tk-000012' }));
  });

  it('chọn ticket đã đóng: tải chi tiết, khoá ô trả lời, gợi ý tạo yêu cầu mới', async () => {
    const { user, location, api } = setup(`/ho-tro?ticket=${T1}`);
    await user.click(
      await within(await screen.findByRole('list', { name: 'Yêu cầu hỗ trợ' })).findByRole(
        'button',
        { name: /#TK-000007/ },
      ),
    );
    expect(location()).toBe(`/ho-tro?ticket=${T2}`);

    const chat = await screen.findByRole('region', { name: 'Hội thoại yêu cầu #TK-000007' });
    expect(api.to(`GET /support/tickets/${T2}`)).toHaveLength(1);
    expect(
      within(chat).getByText('Yêu cầu này đã đóng, không thể gửi thêm tin nhắn.'),
    ).toBeInTheDocument();
    expect(
      within(chat).queryByRole('textbox', { name: 'Tin nhắn trả lời' }),
    ).not.toBeInTheDocument();
    expect(within(chat).getByText(/đang đọc nội dung/)).toBeInTheDocument();

    await user.click(within(chat).getByRole('button', { name: 'Tạo yêu cầu mới' }));
    expect(screen.getByRole('dialog', { name: 'Tạo yêu cầu hỗ trợ mới' })).toBeInTheDocument();
  });

  it('trả lời: validate, gửi đúng body, xoá ô nhập và hiện tin mới', async () => {
    const reply = vi.fn<FakeHandler>((req) =>
      json(
        {
          ...DETAIL_OPEN,
          messages: [...DETAIL_OPEN.messages, customerMsg(9, (req.body as { body: string }).body)],
        },
        201,
      ),
    );
    const { user, api } = setup(`/ho-tro?ticket=${T1}`, {
      [`POST /support/tickets/${T1}/messages`]: reply,
    });
    const box = await screen.findByRole('textbox', { name: 'Tin nhắn trả lời' });

    await user.type(box, '   ');
    await user.click(screen.getByRole('button', { name: 'Gửi' }));
    expect(screen.getByText('Vui lòng nhập nội dung tin nhắn.')).toBeInTheDocument();

    await user.clear(box);
    await user.click(box);
    await user.paste('b'.repeat(5001));
    await user.click(screen.getByRole('button', { name: 'Gửi' }));
    expect(screen.getByText('Tin nhắn tối đa 5.000 ký tự.')).toBeInTheDocument();
    expect(reply).not.toHaveBeenCalled();

    await user.clear(box);
    await user.type(box, '  Cảm ơn Mai Linh nhé!  ');
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    expect(api.to(`POST /support/tickets/${T1}/messages`)[0]!.body).toEqual({
      body: 'Cảm ơn Mai Linh nhé!',
    });
    const chat = conversation();
    await waitFor(() =>
      expect(within(chat).getAllByRole('article', { name: 'Tin nhắn của bạn' })).toHaveLength(2),
    );
    expect(within(chat).getByText('Cảm ơn Mai Linh nhé!')).toBeInTheDocument();
    expect(box).toHaveValue('');
  });

  it('ticket vừa bị đóng (409 TICKET_CLOSED): toast, giữ bản nháp, tải lại hội thoại', async () => {
    const { user, api } = setup(`/ho-tro?ticket=${T1}`, {
      [`POST /support/tickets/${T1}/messages`]: () =>
        apiError(
          409,
          'TICKET_CLOSED',
          'Ticket đã đóng, không thể gửi thêm tin nhắn. Vui lòng tạo ticket mới.',
        ),
    });
    const box = await screen.findByRole('textbox', { name: 'Tin nhắn trả lời' });
    await user.type(box, 'Còn câu hỏi nữa');
    await user.click(screen.getByRole('button', { name: 'Gửi' }));

    expect(await screen.findByText('Yêu cầu đã đóng')).toBeInTheDocument();
    expect(box).toHaveValue('Còn câu hỏi nữa');
    await waitFor(() => expect(api.to(`GET /support/tickets/${T1}`)).toHaveLength(2));
  });

  it('tạo ticket: thiếu tiêu đề/nội dung → báo lỗi, không gọi API', async () => {
    const create = vi.fn<FakeHandler>(() => json(DETAIL_OPEN, 201));
    const { user } = setup('/ho-tro', { 'POST /support/tickets': create });
    await screen.findByRole('list', { name: 'Yêu cầu hỗ trợ' });
    await user.click(screen.getAllByRole('button', { name: 'Tạo yêu cầu mới' })[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Tạo yêu cầu hỗ trợ mới' });
    await user.click(within(dialog).getByRole('button', { name: 'Gửi yêu cầu hỗ trợ' }));
    expect(within(dialog).getByText('Vui lòng nhập tiêu đề yêu cầu.')).toBeInTheDocument();
    expect(within(dialog).getByText('Vui lòng mô tả vấn đề bạn gặp phải.')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('tạo ticket: gửi Idempotency-Key + đơn đã chọn, thử lại sau 503 dùng cùng key', async () => {
    let calls = 0;
    const create = vi.fn<FakeHandler>(() =>
      ++calls === 1
        ? apiError(503, 'SERVICE_UNAVAILABLE', 'Hệ thống đang bận, vui lòng thử lại.')
        : json(
            { ...DETAIL_OPEN, id: NEW, code: 'TK-000020', subject: 'Đổi size dây đồng hồ' },
            201,
          ),
    );
    const { user, location, api } = setup(`/ho-tro?ticket=${T1}`, {
      'POST /support/tickets': create,
      [`GET /support/tickets/${NEW}`]: () =>
        json({ ...DETAIL_OPEN, id: NEW, code: 'TK-000020', subject: 'Đổi size dây đồng hồ' }),
    });
    await screen.findByRole('list', { name: 'Yêu cầu hỗ trợ' });
    await user.click(screen.getAllByRole('button', { name: 'Tạo yêu cầu mới' })[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Tạo yêu cầu hỗ trợ mới' });
    const submit = within(dialog).getByRole('button', { name: 'Gửi yêu cầu hỗ trợ' });

    await user.click(within(dialog).getByRole('textbox', { name: /Tiêu đề yêu cầu/ }));
    await user.paste(' Đổi size dây đồng hồ ');
    await user.click(within(dialog).getByRole('textbox', { name: /Nội dung chi tiết/ }));
    await user.paste('Dây hơi chật');
    const orderSelect = within(dialog).getByRole('combobox', { name: 'Mã đơn hàng liên quan' });
    await within(dialog).findByRole('option', { name: '#SF-000123 (Tai nghe +1) - Đang giao' });
    await user.selectOptions(orderSelect, ORDER);

    await user.click(submit);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Hệ thống đang bận');
    await user.click(submit);

    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    const [first, second] = api.to('POST /support/tickets');
    expect(first!.body).toEqual({
      subject: 'Đổi size dây đồng hồ',
      message: 'Dây hơi chật',
      orderId: ORDER,
    });
    expect(first!.headers['Idempotency-Key']).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(second!.headers['Idempotency-Key']).toBe(first!.headers['Idempotency-Key']);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Đã gửi yêu cầu hỗ trợ')).toBeInTheDocument();
    expect(location()).toBe(`/ho-tro?ticket=${NEW}`);
    expect(
      await screen.findByRole('region', { name: 'Hội thoại yêu cầu #TK-000020' }),
    ).toBeInTheDocument();
  });

  it('sửa nội dung sau lỗi thử lại được → lần gửi sau là yêu cầu mới (key mới)', async () => {
    const create = vi.fn<FakeHandler>(() => apiError(503, 'SERVICE_UNAVAILABLE', 'Bận'));
    const { user, api } = setup('/ho-tro', { 'POST /support/tickets': create });
    await screen.findByRole('list', { name: 'Yêu cầu hỗ trợ' });
    await user.click(screen.getAllByRole('button', { name: 'Tạo yêu cầu mới' })[0]!);
    const dialog = screen.getByRole('dialog');
    const subject = within(dialog).getByRole('textbox', { name: /Tiêu đề yêu cầu/ });
    await user.type(subject, 'Hỏi');
    await user.type(within(dialog).getByRole('textbox', { name: /Nội dung chi tiết/ }), 'Nội dung');
    await user.click(within(dialog).getByRole('button', { name: 'Gửi yêu cầu hỗ trợ' }));
    await within(dialog).findByRole('alert');
    await user.type(subject, ' thêm');
    await user.click(within(dialog).getByRole('button', { name: 'Gửi yêu cầu hỗ trợ' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    const [first, second] = api.to('POST /support/tickets');
    expect(second!.headers['Idempotency-Key']).not.toBe(first!.headers['Idempotency-Key']);
  });

  it('?don=<id> (từ trang theo dõi đơn) mở sẵn form với đơn đã chọn; đóng thì bỏ tham số', async () => {
    const { user, location } = setup(`/ho-tro?don=${ORDER}`);
    const dialog = await screen.findByRole('dialog', { name: 'Tạo yêu cầu hỗ trợ mới' });
    await within(dialog).findByRole('option', { name: /#SF-000123/ });
    expect(within(dialog).getByRole('combobox', { name: 'Mã đơn hàng liên quan' })).toHaveValue(
      ORDER,
    );

    await user.click(within(dialog).getByRole('button', { name: 'Huỷ bỏ' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(location()).not.toContain('don='));
  });

  it('chưa có ticket → CTA tạo yêu cầu mở form', async () => {
    const empty = { ...ticketPage([]), statusCounts: { OPEN: 0, ANSWERED: 0, CLOSED: 0 } };
    const { user } = setup('/ho-tro', { 'GET /support/tickets/me': () => json(empty) });
    expect(await screen.findByText('Bạn chưa có yêu cầu hỗ trợ nào')).toBeInTheDocument();
    expect(screen.getByText('Chọn một yêu cầu để xem hội thoại')).toBeInTheDocument();
    const cta = screen.getAllByRole('button', { name: 'Tạo yêu cầu mới' });
    expect(cta).toHaveLength(2);
    await user.click(cta[1]!);
    expect(screen.getByRole('dialog', { name: 'Tạo yêu cầu hỗ trợ mới' })).toBeInTheDocument();
  });

  it('lọc không khớp → "Xem tất cả" xoá bộ lọc', async () => {
    const { user, location } = setup('/ho-tro?tab=closed&q=zzz', {
      'GET /support/tickets/me': (req) =>
        json(req.query.get('q') ? ticketPage([]) : ticketPage([OPEN, CLOSED], 4)),
    });
    expect(await screen.findByText('Không có yêu cầu phù hợp')).toBeInTheDocument();
    expect(screen.getByText(/khớp “zzz”/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Xem tất cả' }));
    await waitFor(() => expect(location()).toBe(`/ho-tro?ticket=${T1}`));
  });

  it('lỗi tải danh sách → "Thử lại"', async () => {
    let fail = true;
    const { user } = setup('/ho-tro', {
      'GET /support/tickets/me': () =>
        fail
          ? apiError(503, 'SERVICE_UNAVAILABLE', 'Hệ thống đang bận.')
          : json(ticketPage([OPEN])),
    });
    expect(await screen.findByText('Không tải được danh sách yêu cầu')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(
      await within(await screen.findByRole('list', { name: 'Yêu cầu hỗ trợ' })).findByRole(
        'button',
        { name: /#TK-000012/ },
      ),
    ).toBeInTheDocument();
  });

  it('ticket không tồn tại / của người khác (404) → "Không tìm thấy yêu cầu"', async () => {
    const { user, location } = setup(`/ho-tro?tab=closed&ticket=${MISSING}`);
    expect(await screen.findByText('Không tìm thấy yêu cầu')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Về danh sách yêu cầu' }));
    expect(location()).not.toContain(MISSING);
  });

  it('mobile: không tự mở ticket; chọn ticket thì hiện hội thoại kèm nút quay lại', async () => {
    viewport(false);
    const { user, location, api } = setup();
    const item = await within(
      await screen.findByRole('list', { name: 'Yêu cầu hỗ trợ' }),
    ).findByRole('button', { name: /#TK-000012/ });
    expect(location()).toBe('/ho-tro');
    expect(api.to(`GET /support/tickets/${T1}`)).toHaveLength(0);

    await user.click(item);
    const chat = await screen.findByRole('region', { name: 'Hội thoại yêu cầu #TK-000012' });
    await user.click(within(chat).getByRole('button', { name: 'Danh sách yêu cầu' }));
    expect(location()).toBe('/ho-tro');
  });
});
