import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MyOrderPage, Order } from '../orders/my-orders-api';
import type { StatusCounts } from '../orders/my-orders-filters';
import { apiError, fakeApi, json, loginAs, type FakeHandler } from '../test/fake-api';
import { renderPage } from '../test/render';
import { MyOrdersPage } from './MyOrdersPage';

const COUNTS: StatusCounts = {
  PENDING_PAYMENT: 1,
  PAID: 1,
  PROCESSING: 2,
  SHIPPING: 1,
  DELIVERED: 2,
  CANCELLED: 0,
};

function order(code: string, status: Order['status'], items: Order['items']): Order {
  return {
    id: `id-${code}`,
    code,
    status,
    totalAmount: items.reduce((s, i) => s + i.lineTotal, 0),
    paidAt: null,
    createdAt: '2024-10-24T07:35:00.000Z',
    items,
  };
}

const item = (productId: number, name: string, quantity: number, unitPrice: number) => ({
  productId,
  sku: `SF-${productId}`,
  name,
  quantity,
  unitPrice,
  lineTotal: quantity * unitPrice,
});

const SHIPPING = order('SF-000123', 'SHIPPING', [
  item(1, 'Tai nghe AirPods Pro 2', 1, 5_490_000),
  item(2, 'Đồng hồ Galaxy Watch 6', 1, 4_190_000),
  item(3, 'Củ sạc Anker 65W', 2, 540_000),
]);
const DELIVERED = order('SF-000099', 'DELIVERED', [
  item(4, 'Loa Sony XB100', 1, 990_000),
  item(5, 'Cáp Baseus 100W', 3, 150_000),
]);
const PENDING = order('SF-000130', 'PENDING_PAYMENT', [item(6, 'Bàn phím Asus', 1, 2_000_000)]);

function page(items: Order[], total = items.length, pageNo = 1): MyOrderPage {
  return {
    items,
    meta: { page: pageNo, limit: 10, total, totalPages: Math.max(1, Math.ceil(total / 10)) },
    statusCounts: COUNTS,
  };
}

function setup(
  route = '/don-hang',
  orders: FakeHandler = () => json(page([SHIPPING, DELIVERED, PENDING], 7)),
  addItem: FakeHandler = () => json({ items: [] }, 201),
) {
  const api = fakeApi({ 'GET /orders/me': orders, 'POST /cart/items': addItem });
  const view = renderPage(<MyOrdersPage />, { route, path: '/don-hang' });
  return {
    ...view,
    api,
    lastQuery: () => Object.fromEntries(api.to('GET /orders/me').at(-1)!.query),
  };
}

const card = (code: string) =>
  screen.getByText(`#${code}`).closest('[data-testid="order-card"]') as HTMLElement;

describe('MyOrdersPage', () => {
  beforeEach(() => loginAs('CUSTOMER'));

  it('skeleton rồi thẻ đơn: mã, trạng thái, giờ đặt, món đầu, "+ và N sản phẩm khác", tổng', async () => {
    const { lastQuery } = setup();
    expect(screen.getByRole('status', { name: 'Đang tải đơn hàng' })).toBeInTheDocument();

    const shipping = await screen.findByText('#SF-000123').then(() => card('SF-000123'));
    expect(within(shipping).getByText('Đang giao')).toBeInTheDocument();
    expect(within(shipping).getByText('14:35 - 24/10/2024')).toBeInTheDocument();
    expect(within(shipping).getByRole('link', { name: 'Tai nghe AirPods Pro 2' })).toHaveAttribute(
      'href',
      '/san-pham/1',
    );
    expect(within(shipping).getByText('+ và 2 sản phẩm khác:')).toBeInTheDocument();
    expect(within(shipping).getByTestId('order-total').textContent).toBe('10.760.000 ₫');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('(7 đơn hàng)');
    expect(screen.getByRole('tab', { name: /Đang xử lý/ })).toHaveTextContent('Đang xử lý3');
    expect(screen.getByRole('tab', { name: /Tất cả/ })).toHaveAttribute('aria-selected', 'true');
    expect(lastQuery()).toEqual({ page: '1', limit: '10' });
  });

  it('bấm tab "Đang xử lý" → URL ?tab=processing, API nhận status=PAID,PROCESSING', async () => {
    const { user, location, lastQuery } = setup('/don-hang?page=2');
    await screen.findByText('#SF-000123');

    await user.click(screen.getByRole('tab', { name: /Đang xử lý/ }));
    expect(location()).toBe('/don-hang?tab=processing');
    await waitFor(() =>
      expect(lastQuery()).toEqual({ status: 'PAID,PROCESSING', page: '1', limit: '10' }),
    );
  });

  it('tìm kiếm: ghi q lên URL; quá 100 ký tự → lỗi, URL không đổi; xoá từ khoá', async () => {
    const { user, location, lastQuery } = setup('/don-hang?tab=shipping');
    await screen.findByText('#SF-000123');
    const box = screen.getByRole('searchbox', { name: 'Tìm theo mã đơn hoặc tên sản phẩm' });

    // Dán chuỗi dài (gõ từng ký tự 101 lần chậm, dễ quá thời gian khi máy bận).
    await user.click(box);
    await user.paste('a'.repeat(101));
    await user.click(screen.getByRole('button', { name: 'Tìm' }));
    expect(box).toHaveAccessibleDescription('Từ khoá tối đa 100 ký tự.');
    expect(location()).toBe('/don-hang?tab=shipping');

    await user.clear(box);
    await user.type(box, '  sf-000123 {Enter}');
    expect(location()).toBe('/don-hang?tab=shipping&q=sf-000123');
    await waitFor(() => expect(lastQuery()).toMatchObject({ status: 'SHIPPING', q: 'sf-000123' }));

    await user.click(screen.getByRole('button', { name: 'Xoá từ khoá' }));
    expect(location()).toBe('/don-hang?tab=shipping');
  });

  it('URL có sẵn bộ lọc → tab chọn sẵn, ô tìm có từ khoá, request đúng tham số', async () => {
    const { lastQuery } = setup('/don-hang?tab=delivered&q=loa&page=2', () =>
      json(page([DELIVERED], 12, 2)),
    );
    await screen.findByText('#SF-000099');

    expect(screen.getByRole('tab', { name: /Đã giao/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('searchbox')).toHaveValue('loa');
    expect(lastQuery()).toEqual({ status: 'DELIVERED', q: 'loa', page: '2', limit: '10' });
  });

  it('"Xem tất cả" mở/thu danh sách món của đơn', async () => {
    const { user } = setup();
    await screen.findByText('#SF-000123');
    const shipping = card('SF-000123');

    expect(
      within(shipping).queryByRole('link', { name: 'Củ sạc Anker 65W' }),
    ).not.toBeInTheDocument();
    await user.click(within(shipping).getByRole('button', { name: /Xem tất cả/ }));
    expect(within(shipping).getByRole('link', { name: 'Củ sạc Anker 65W' })).toBeInTheDocument();
    expect(within(shipping).getByText('SKU: SF-3 | Số lượng: 2')).toBeInTheDocument();
    await user.click(within(shipping).getByRole('button', { name: /Thu gọn/ }));
    expect(
      within(shipping).queryByRole('link', { name: 'Củ sạc Anker 65W' }),
    ).not.toBeInTheDocument();
  });

  it('nút theo trạng thái: đang giao → Theo dõi; đã giao → Mua lại; chờ thanh toán → Xem chi tiết', async () => {
    setup();
    await screen.findByText('#SF-000123');

    expect(
      within(card('SF-000123')).getByRole('link', { name: /Theo dõi đơn hàng/ }),
    ).toHaveAttribute('href', '/don-hang/id-SF-000123');
    expect(
      within(card('SF-000123')).queryByRole('button', { name: /Mua lại/ }),
    ).not.toBeInTheDocument();
    expect(
      within(card('SF-000099')).getByRole('button', { name: 'Mua lại đơn SF-000099' }),
    ).toBeInTheDocument();
    expect(within(card('SF-000130')).getByRole('link', { name: 'Xem chi tiết' })).toHaveAttribute(
      'href',
      '/don-hang/id-SF-000130',
    );
  });

  it('"Mua lại": thêm từng món đúng số lượng, báo món lỗi, sang giỏ hàng', async () => {
    const { user, api, location } = setup(undefined, undefined, (req) =>
      (req.body as { productId: number }).productId === 5
        ? apiError(409, 'INSUFFICIENT_STOCK', 'Sản phẩm "Cáp Baseus 100W" đã hết hàng.')
        : json({ items: [] }, 201),
    );
    await screen.findByText('#SF-000099');

    await user.click(screen.getByRole('button', { name: 'Mua lại đơn SF-000099' }));
    await waitFor(() => expect(location()).toBe('/gio-hang'));
    expect(api.to('POST /cart/items').map((r) => r.body)).toEqual([
      { productId: 4, quantity: 1 },
      { productId: 5, quantity: 3 },
    ]);
    expect(screen.getByText('Đã thêm 1/2 sản phẩm vào giỏ')).toBeInTheDocument();
    expect(
      screen.getByText(/Cáp Baseus 100W: Sản phẩm "Cáp Baseus 100W" đã hết hàng\./),
    ).toBeInTheDocument();
  });

  it('"Mua lại" mà mọi món đều lỗi → ở lại trang, báo lỗi', async () => {
    const { user, location } = setup(undefined, undefined, () =>
      apiError(409, 'INSUFFICIENT_STOCK', 'Hết hàng.'),
    );
    await screen.findByText('#SF-000099');

    await user.click(screen.getByRole('button', { name: 'Mua lại đơn SF-000099' }));
    expect(await screen.findByText('Không thêm được sản phẩm nào vào giỏ')).toBeInTheDocument();
    expect(location()).toBe('/don-hang');
  });

  it('chưa có đơn nào → mời mua sắm', async () => {
    setup('/don-hang', () =>
      json({
        ...page([], 0),
        statusCounts: {
          ...COUNTS,
          PENDING_PAYMENT: 0,
          PAID: 0,
          PROCESSING: 0,
          SHIPPING: 0,
          DELIVERED: 0,
        },
      }),
    );
    expect(await screen.findByText('Bạn chưa có đơn hàng nào')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Mua sắm ngay/ })).toHaveAttribute('href', '/san-pham');
  });

  it('lọc không ra đơn → "Xem tất cả đơn" xoá tab và từ khoá', async () => {
    const { user, location } = setup('/don-hang?tab=cancelled&q=abc', () => json(page([], 0)));
    expect(await screen.findByText('Không có đơn phù hợp')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Xem tất cả đơn' }));
    expect(location()).toBe('/don-hang');
  });

  it('lỗi server → thông điệp + "Thử lại"', async () => {
    let fail = true;
    const { user } = setup('/don-hang', () =>
      fail ? apiError(503, 'SERVICE_UNAVAILABLE', 'Hệ thống đang bận.') : json(page([SHIPPING])),
    );
    expect(await screen.findByText('Hệ thống đang bận.')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('#SF-000123')).toBeInTheDocument();
  });

  it('phân trang: bấm trang 2 → ?page=2, giữ tab', async () => {
    const { user, location, lastQuery } = setup('/don-hang?tab=delivered', ({ query }) =>
      json(page([DELIVERED], 25, Number(query.get('page')))),
    );
    await screen.findByText('#SF-000099');

    await user.click(screen.getByRole('button', { name: '2' }));
    expect(location()).toBe('/don-hang?tab=delivered&page=2');
    await waitFor(() => expect(lastQuery()).toMatchObject({ page: '2', status: 'DELIVERED' }));
  });
});
