import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Cart, CartItem } from '../cart/cart-api';
import { CustomerLayout } from '../layouts/CustomerLayout';
import { apiError, fakeApi, json, loginAs, type FakeHandler } from '../test/fake-api';
import { renderPage } from '../test/render';
import { CartPage } from './CartPage';

interface Line {
  productId: number;
  name: string;
  unitPrice: number;
  quantity: number;
  available: number;
}

const INITIAL: Line[] = [
  {
    productId: 1,
    name: 'Tai nghe AirPods Pro 2',
    unitPrice: 5_490_000,
    quantity: 1,
    available: 50,
  },
  { productId: 2, name: 'Đồng hồ Galaxy Watch 6', unitPrice: 4_190_000, quantity: 2, available: 3 },
  { productId: 3, name: 'Củ sạc Anker 65W', unitPrice: 540_000, quantity: 1, available: 40 },
];

function toCart(lines: Line[]): Cart {
  const items: CartItem[] = lines.map((l) => ({
    productId: l.productId,
    sku: `SF-${l.productId}`,
    name: l.name,
    slug: `sp-${l.productId}`,
    unitPrice: l.unitPrice,
    quantity: l.quantity,
    lineTotal: l.unitPrice * l.quantity,
    available: l.available,
    insufficientStock: l.quantity > l.available,
  }));
  return {
    items,
    totalQuantity: items.reduce((s, i) => s + i.quantity, 0),
    subtotal: items.reduce((s, i) => s + i.lineTotal, 0),
  };
}

/** Server giỏ hàng giả có trạng thái: PATCH/DELETE đổi dữ liệu GET /cart trả về. */
function setup(options: { lines?: Line[]; patch?: FakeHandler; state?: unknown } = {}) {
  let lines = (options.lines ?? INITIAL).map((l) => ({ ...l }));
  const routes: Record<string, FakeHandler> = {
    'GET /cart': () => json(toCart(lines)),
    'DELETE /cart': () => {
      lines = [];
      return json(null, 204);
    },
  };
  for (const line of lines) {
    routes[`PATCH /cart/items/${line.productId}`] = (req) => {
      if (options.patch) return options.patch(req);
      const quantity = (req.body as { quantity: number }).quantity;
      lines = lines.map((l) => (l.productId === line.productId ? { ...l, quantity } : l));
      return json(toCart(lines));
    };
    routes[`DELETE /cart/items/${line.productId}`] = () => {
      lines = lines.filter((l) => l.productId !== line.productId);
      return json(null, 204);
    };
  }
  const api = fakeApi(routes);
  const route = options.state ? { pathname: '/gio-hang', state: options.state } : '/gio-hang';
  return { ...renderPage(<CartPage />, { route, path: '/gio-hang' }), api };
}

const line = (name: string) =>
  screen.getByRole('link', { name }).closest('[data-testid="cart-line"]') as HTMLElement;
const orderButton = () => screen.getByRole('button', { name: /Tiến hành đặt hàng/ });
const qty = (name: string) => screen.getByRole('textbox', { name: `Số lượng ${name}` });

describe('CartPage', () => {
  beforeEach(() => loginAs('CUSTOMER'));

  it('skeleton rồi các dòng giỏ: đơn giá, thành tiền, tạm tính, tổng', async () => {
    setup();
    expect(screen.getByRole('status', { name: 'Đang tải giỏ hàng' })).toBeInTheDocument();

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Giỏ hàng(3 sản phẩm)',
    );
    const watch = line('Đồng hồ Galaxy Watch 6');
    expect(within(watch).getByTestId('line-total')).toHaveTextContent('8.380.000');
    expect(screen.getByRole('link', { name: 'Đồng hồ Galaxy Watch 6' })).toHaveAttribute(
      'href',
      '/san-pham/2',
    );
    expect(screen.getByText('4 món')).toBeInTheDocument();
    expect(screen.getByTestId('order-total').textContent).toBe('14.410.000 ₫');
  });

  it('giỏ trống → EmptyState với link mua sắm', async () => {
    setup({ lines: [] });
    expect(await screen.findByText('Giỏ hàng đang trống')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Tiếp tục mua sắm/ })).toHaveAttribute(
      'href',
      '/san-pham',
    );
  });

  it('lỗi tải giỏ → thông điệp + "Thử lại"', async () => {
    let fail = true;
    fakeApi({
      'GET /cart': () =>
        fail ? apiError(503, 'SERVICE_UNAVAILABLE', 'Hệ thống đang bận.') : json(toCart(INITIAL)),
    });
    const { user } = renderPage(<CartPage />, { route: '/gio-hang', path: '/gio-hang' });
    expect(await screen.findByText('Hệ thống đang bận.')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Củ sạc Anker 65W')).toBeInTheDocument();
  });

  it('nút + → PATCH số lượng mới, thành tiền và tổng cập nhật theo server', async () => {
    const { user, api } = setup();
    await screen.findByText('Củ sạc Anker 65W');

    await user.click(
      within(line('Củ sạc Anker 65W')).getByRole('button', { name: 'Tăng số lượng' }),
    );
    await waitFor(() =>
      expect(within(line('Củ sạc Anker 65W')).getByTestId('line-total')).toHaveTextContent(
        '1.080.000',
      ),
    );
    expect(api.to('PATCH /cart/items/3')[0]!.body).toEqual({ quantity: 2 });
    expect(screen.getByTestId('order-total')).toHaveTextContent('14.950.000');
  });

  it('gõ số lượng sai → lỗi tiếng Việt, không PATCH, chặn đặt hàng; gõ đúng + Enter → PATCH', async () => {
    const { user, api } = setup();
    await screen.findByText('Củ sạc Anker 65W');
    const input = qty('Tai nghe AirPods Pro 2');

    await user.clear(input);
    await user.type(input, '0');
    await user.tab();
    expect(input).toHaveAccessibleDescription('Số lượng tối thiểu là 1.');
    expect(orderButton()).toBeDisabled();
    expect(screen.getByText('Vui lòng sửa số lượng không hợp lệ.')).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, '60');
    expect(input).toHaveAccessibleDescription('Chỉ còn 50 sản phẩm.');
    expect(api.to('PATCH /cart/items/1')).toHaveLength(0);

    await user.clear(input);
    await user.type(input, '4{Enter}');
    await waitFor(() => expect(api.to('PATCH /cart/items/1')).toHaveLength(1));
    expect(api.to('PATCH /cart/items/1')[0]!.body).toEqual({ quantity: 4 });
    await waitFor(() => expect(orderButton()).toBeEnabled());
  });

  it('PATCH bị từ chối → thông điệp server ở dòng, ô số lượng về giá trị cũ', async () => {
    const { user } = setup({
      patch: () =>
        apiError(409, 'INSUFFICIENT_STOCK', 'Sản phẩm "Củ sạc Anker 65W" chỉ còn 1, không đủ 2.'),
    });
    await screen.findByText('Củ sạc Anker 65W');

    await user.click(
      within(line('Củ sạc Anker 65W')).getByRole('button', { name: 'Tăng số lượng' }),
    );
    expect(
      await within(line('Củ sạc Anker 65W')).findByText(
        'Sản phẩm "Củ sạc Anker 65W" chỉ còn 1, không đủ 2.',
      ),
    ).toBeInTheDocument();
    expect(qty('Củ sạc Anker 65W')).toHaveValue('1');
  });

  it('xoá một dòng → DELETE, dòng biến mất; "Xoá tất cả" qua Modal → DELETE /cart', async () => {
    const { user, api } = setup();
    await screen.findByText('Củ sạc Anker 65W');

    await user.click(screen.getByRole('button', { name: 'Xoá Củ sạc Anker 65W khỏi giỏ' }));
    // Tên vẫn có trong toast "Đã xoá…" nên kiểm theo link của dòng.
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Củ sạc Anker 65W' })).not.toBeInTheDocument(),
    );
    expect(api.to('DELETE /cart/items/3')).toHaveLength(1);
    expect(await screen.findByText('Đã xoá khỏi giỏ hàng')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Xoá tất cả' }));
    const dialog = screen.getByRole('dialog', { name: 'Xoá toàn bộ giỏ hàng?' });
    await user.click(within(dialog).getByRole('button', { name: 'Xoá tất cả' }));
    expect(await screen.findByText('Giỏ hàng đang trống')).toBeInTheDocument();
    expect(api.to('DELETE /cart')).toHaveLength(1);
  });

  it('cảnh báo tồn kho theo dòng: sắp hết (cam) và thiếu hàng (đỏ, chặn đặt hàng)', async () => {
    const { user, api } = setup({
      lines: [
        { ...INITIAL[0]!, quantity: 1, available: 4 },
        { ...INITIAL[1]!, quantity: 3, available: 1 },
      ],
    });
    await screen.findByText('Tai nghe AirPods Pro 2');

    expect(
      within(line('Tai nghe AirPods Pro 2')).getByText(/Chỉ còn 4 sản phẩm trong kho!/),
    ).toBeInTheDocument();
    const short = line('Đồng hồ Galaxy Watch 6');
    expect(within(short).getByRole('alert')).toHaveTextContent(
      'Chỉ còn 1 sản phẩm, bạn đang chọn 3.',
    );
    expect(orderButton()).toBeDisabled();
    expect(
      screen.getByText('Có sản phẩm không đủ hàng, vui lòng cập nhật số lượng trước khi đặt.'),
    ).toBeInTheDocument();

    await user.click(within(short).getByRole('button', { name: 'Cập nhật về 1' }));
    await waitFor(() => expect(orderButton()).toBeEnabled());
    expect(api.to('PATCH /cart/items/2')[0]!.body).toEqual({ quantity: 1 });
  });

  it('quay lại từ thanh toán sau 409 → thiếu hàng hiện đúng dòng; sửa dòng thì hết chặn', async () => {
    const { user } = setup({
      state: {
        shortages: [
          { productId: 2, sku: 'SF-2', name: 'Đồng hồ Galaxy Watch 6', requested: 2, available: 1 },
        ],
      },
    });
    expect(await screen.findByText('1 sản phẩm không đủ hàng.')).toBeInTheDocument();
    const short = line('Đồng hồ Galaxy Watch 6');
    expect(within(short).getByRole('alert')).toHaveTextContent(
      'Chỉ còn 1 sản phẩm, bạn đang chọn 2.',
    );
    expect(orderButton()).toBeDisabled();

    await user.click(within(short).getByRole('button', { name: 'Cập nhật về 1' }));
    await waitFor(() => expect(orderButton()).toBeEnabled());
  });

  it('"Tiến hành đặt hàng" chỉ chuyển sang /thanh-toan, chưa tạo đơn', async () => {
    const { user, api, location } = setup();
    await screen.findByText('Củ sạc Anker 65W');

    await user.click(orderButton());
    expect(await screen.findByText('Trang khác')).toBeInTheDocument();
    expect(location()).toBe('/thanh-toan');
    expect(api.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
  });
});

describe('CustomerLayout – số món trên icon giỏ', () => {
  it('khách hàng thấy tổng số lượng trong giỏ', async () => {
    loginAs('CUSTOMER');
    fakeApi({ 'GET /cart': () => json(toCart(INITIAL)), 'GET /auth/me': () => json({}) });
    renderPage(<CustomerLayout />, { route: '/', path: '/' });
    expect(await screen.findByRole('link', { name: 'Giỏ hàng (4 món)' })).toBeInTheDocument();
  });

  it('khách vãng lai: không gọi API giỏ', () => {
    const api = fakeApi({});
    renderPage(<CustomerLayout />, { route: '/', path: '/' });
    expect(screen.getByRole('link', { name: 'Giỏ hàng' })).toBeInTheDocument();
    expect(api.to('GET /cart')).toHaveLength(0);
  });
});
