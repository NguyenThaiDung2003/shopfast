import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderStatus } from '../orders/order-status';
import { apiError, fakeApi, json, loginAs, type FakeHandler } from '../test/fake-api';
import { renderPage } from '../test/render';
import type { StaffOrder, StaffOrderPage } from '../warehouse/warehouse-api';
import { WarehouseOrdersPage } from './WarehouseOrdersPage';

const PATH = '/quan-tri/kho/don-hang';
const COUNTS = {
  PENDING_PAYMENT: 2,
  PAID: 5,
  PROCESSING: 3,
  SHIPPING: 4,
  DELIVERED: 10,
  CANCELLED: 1,
};

function order(code: string, status: OrderStatus, nextStatuses: OrderStatus[]): StaffOrder {
  return {
    id: `id-${code}`,
    code,
    status,
    totalAmount: 1_450_000,
    paidAt: status === 'PENDING_PAYMENT' ? null : '2024-10-24T07:36:00.000Z',
    createdAt: '2024-10-24T07:35:00.000Z',
    items: [
      { productId: 1, sku: 'A', name: 'AirPods Pro 2', quantity: 2, unitPrice: 1, lineTotal: 2 },
      { productId: 2, sku: 'B', name: 'Galaxy Watch 6', quantity: 1, unitPrice: 1, lineTotal: 1 },
    ],
    customer: { id: 'c1', fullName: 'Nguyễn Văn Minh', email: 'minh@example.com' },
    nextStatuses,
  };
}

const PROCESSING = order('SF-000234', 'PROCESSING', ['SHIPPING', 'CANCELLED']);
const SHIPPING = order('SF-000230', 'SHIPPING', ['DELIVERED']);
const DELIVERED = order('SF-000228', 'DELIVERED', []);

function page(items: StaffOrder[]): StaffOrderPage {
  return {
    items,
    meta: { page: 1, limit: 25, total: items.length, totalPages: 1 },
    statusCounts: COUNTS,
  };
}

function setup(route = PATH, routes: Record<string, FakeHandler> = {}) {
  const api = fakeApi({
    'GET /orders': () => json(page([PROCESSING, SHIPPING, DELIVERED])),
    ...routes,
  });
  const view = renderPage(<WarehouseOrdersPage />, { route, path: PATH });
  return {
    ...view,
    api,
    lastQuery: () => Object.fromEntries(api.to('GET /orders').at(-1)!.query),
  };
}

const row = async (code: string) =>
  (await screen.findByText(`#${code}`)).closest('tr') as HTMLElement;

describe('WarehouseOrdersPage', () => {
  beforeEach(() => loginAs('WAREHOUSE'));

  it('bảng đơn + thẻ thống kê + tab có số đếm', async () => {
    const { lastQuery } = setup();
    const r = await row('SF-000234');
    expect(r).toHaveTextContent('Nguyễn Văn Minh');
    expect(r).toHaveTextContent('minh@example.com');
    expect(r).toHaveTextContent('Đang xử lý');
    expect(r).toHaveTextContent('3 sản phẩm');
    expect(r).toHaveTextContent('AirPods Pro 2, Galaxy Watch 6');
    expect(r).toHaveTextContent('1.450.000');
    expect(lastQuery()).toMatchObject({ page: '1', limit: '25' });
    expect(lastQuery()).not.toHaveProperty('status');

    expect(screen.getByText('25 đơn')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Đang giao\s*4 đơn/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tất cả 25' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Đã huỷ 1' })).toBeInTheDocument();
  });

  it('chỉ hiện nút cho các bước API cho phép (nextStatuses)', async () => {
    setup();
    const processing = await row('SF-000234');
    const names = (el: HTMLElement) =>
      within(el)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
        .filter((name) => !name?.startsWith('Sao chép'));
    expect(names(processing)).toEqual([
      'Chuyển sang Đang giao – đơn SF-000234',
      'Huỷ đơn – đơn SF-000234',
    ]);

    const shipping = await row('SF-000230');
    expect(
      within(shipping).getByRole('button', { name: 'Xác nhận đã giao – đơn SF-000230' }),
    ).toBeInTheDocument();
    expect(within(shipping).queryByRole('button', { name: /Huỷ đơn/ })).not.toBeInTheDocument();

    const delivered = await row('SF-000228');
    expect(within(delivered).getByText('Đã hoàn tất')).toBeInTheDocument();
    expect(within(delivered).getAllByRole('button')).toHaveLength(1); // chỉ nút sao chép mã
  });

  it('tab + thẻ thống kê + tìm kiếm ghi URL và gửi đúng tham số', async () => {
    const { user, location, lastQuery } = setup();
    await row('SF-000234');

    await user.click(screen.getByRole('tab', { name: /Đang giao/ }));
    expect(location()).toBe(`${PATH}?status=SHIPPING`);
    await waitFor(() => expect(lastQuery()).toMatchObject({ status: 'SHIPPING' }));

    await user.click(screen.getByRole('button', { name: /Đã thanh toán\s*5 đơn/ }));
    expect(location()).toBe(`${PATH}?status=PAID`);

    const search = screen.getByRole('searchbox', { name: 'Tìm đơn hàng' });
    await user.click(search);
    await user.paste('a'.repeat(101));
    await user.keyboard('{Enter}');
    expect(screen.getByText('Từ khoá tối đa 100 ký tự.')).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'minh{Enter}');
    expect(location()).toBe(`${PATH}?status=PAID&q=minh`);
    await waitFor(() => expect(lastQuery()).toMatchObject({ status: 'PAID', q: 'minh' }));
  });

  it('chuyển trạng thái: modal xác nhận, PATCH đúng body, toast và tải lại', async () => {
    let shipped = false;
    const patch = vi.fn<FakeHandler>((req) => {
      shipped = true;
      return json({
        ...PROCESSING,
        status: (req.body as { status: OrderStatus }).status,
        nextStatuses: ['DELIVERED'],
      });
    });
    const { user, api } = setup(PATH, {
      'GET /orders': () =>
        json(
          page([
            shipped
              ? { ...PROCESSING, status: 'SHIPPING', nextStatuses: ['DELIVERED'] }
              : PROCESSING,
          ]),
        ),
      [`PATCH /orders/${PROCESSING.id}/status`]: patch,
    });
    const r = await row('SF-000234');
    await user.click(within(r).getByRole('button', { name: /Chuyển sang Đang giao/ }));

    const dialog = screen.getByRole('dialog', { name: 'Xác nhận chuyển trạng thái' });
    expect(dialog).toHaveTextContent('#SF-000234');
    expect(dialog).toHaveTextContent('Nguyễn Văn Minh • 3 sản phẩm');
    await user.type(within(dialog).getByRole('textbox', { name: /Ghi chú/ }), 'GHN-123456');
    await user.click(within(dialog).getByRole('button', { name: 'Xác nhận chuyển' }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]![0].body).toEqual({ status: 'SHIPPING', note: 'GHN-123456' });
    expect(await screen.findByText('Cập nhật thành công')).toBeInTheDocument();
    expect(screen.getByText('Đơn #SF-000234 đã chuyển sang Đang giao.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(api.to('GET /orders').length).toBeGreaterThanOrEqual(2));
    expect(
      await within(await row('SF-000234')).findByRole('button', { name: /Xác nhận đã giao/ }),
    ).toBeInTheDocument();
  });

  it('huỷ đơn bắt buộc lý do; 409 INVALID_STATUS_TRANSITION → toast lỗi, đóng modal, tải lại', async () => {
    const patch = vi.fn<FakeHandler>(() =>
      apiError(
        409,
        'INVALID_STATUS_TRANSITION',
        'Không thể chuyển đơn từ "Đang giao" sang "Đã huỷ". Có thể chuyển sang: "Đã giao".',
      ),
    );
    const { user, api } = setup(PATH, { [`PATCH /orders/${PROCESSING.id}/status`]: patch });
    const r = await row('SF-000234');
    await user.click(within(r).getByRole('button', { name: /Huỷ đơn/ }));
    const dialog = screen.getByRole('dialog', { name: 'Xác nhận huỷ đơn' });
    expect(dialog).toHaveTextContent('hoàn lại tồn kho');

    await user.click(within(dialog).getByRole('button', { name: 'Xác nhận huỷ đơn' }));
    expect(within(dialog).getByText('Vui lòng nhập lý do huỷ đơn.')).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();

    const before = api.to('GET /orders').length;
    await user.type(within(dialog).getByRole('textbox', { name: /Lý do huỷ đơn/ }), 'Khách đổi ý');
    await user.click(within(dialog).getByRole('button', { name: 'Xác nhận huỷ đơn' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]![0].body).toEqual({ status: 'CANCELLED', note: 'Khách đổi ý' });
    expect(await screen.findByText('Chuyển trạng thái không hợp lệ')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(api.to('GET /orders').length).toBeGreaterThan(before));
  });

  it('lỗi tải → "Thử lại"; lọc không khớp → "Xem tất cả đơn"; đổi số dòng → limit', async () => {
    let fail = true;
    const { user, location, lastQuery } = setup(`${PATH}?status=CANCELLED`, {
      'GET /orders': (req) =>
        fail
          ? apiError(503, 'SERVICE_UNAVAILABLE', 'Hệ thống đang bận.')
          : json(page(req.query.get('status') ? [] : [PROCESSING])),
    });
    expect(await screen.findByText('Không tải được danh sách đơn')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Không có đơn phù hợp')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Xem tất cả đơn' }));
    expect(location()).toBe(PATH);
    await row('SF-000234');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Số dòng' }), '50');
    expect(location()).toBe(`${PATH}?limit=50`);
    await waitFor(() => expect(lastQuery()).toMatchObject({ limit: '50' }));
  });
});
