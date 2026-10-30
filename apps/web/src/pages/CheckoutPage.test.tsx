import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cart, CartItem } from '../cart/cart-api';
import { apiError, fakeApi, json, loginAs, type FakeHandler } from '../test/fake-api';
import { renderPage } from '../test/render';
import { CheckoutPage } from './CheckoutPage';

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const ORDER_ID = '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607';

const line = (productId: number, name: string, over: Partial<CartItem> = {}): CartItem => ({
  productId,
  sku: `SF-${productId}`,
  name,
  slug: `sp-${productId}`,
  unitPrice: 1_000_000,
  quantity: 2,
  lineTotal: 2_000_000,
  available: 10,
  insufficientStock: false,
  ...over,
});
const cartOf = (items: CartItem[]): Cart => ({
  items,
  totalQuantity: items.reduce((s, i) => s + i.quantity, 0),
  subtotal: items.reduce((s, i) => s + i.lineTotal, 0),
});
const CART = cartOf([line(1, 'Tai nghe AirPods'), line(2, 'Đồng hồ Galaxy Watch')]);
const created = () =>
  json({ id: ORDER_ID, code: 'SF-000123', status: 'PENDING_PAYMENT', totalAmount: 4_000_000 }, 201);

function setup(routes: Record<string, FakeHandler> = {}) {
  const api = fakeApi({
    'GET /cart': () => json(CART),
    'POST /orders': created,
    ...routes,
  });
  const view = renderPage(<CheckoutPage />, { route: '/thanh-toan', path: '/thanh-toan' });
  return { ...view, api };
}

type User = ReturnType<typeof setup>['user'];

async function fill(user: User) {
  const set = async (name: RegExp, value: string) => {
    await user.click(screen.getByRole('textbox', { name }));
    await user.paste(value);
  };
  await set(/Họ và tên/, 'Nguyễn Văn Minh');
  await set(/Số điện thoại/, '0912 345 678');
  await set(/Tỉnh \/ Thành phố/, 'TP. Hồ Chí Minh');
  await set(/Quận \/ Huyện/, 'Quận 1, Phường Bến Nghé');
  await set(/Địa chỉ chi tiết/, '123 Lê Lợi');
}

const placeButton = () => screen.getByRole('button', { name: /Đặt hàng \(\d/ });

describe('CheckoutPage', () => {
  beforeEach(() => loginAs('CUSTOMER'));

  it('skeleton rồi tóm tắt đơn: món, tổng, chỉ COD và giao tiêu chuẩn', async () => {
    setup();
    expect(screen.getByRole('status', { name: 'Đang tải đơn hàng' })).toBeInTheDocument();
    const summary = await screen.findByRole('complementary', { name: 'Tóm tắt đơn hàng' });
    expect(summary).toHaveTextContent('Tai nghe AirPods');
    expect(within(summary).getByTestId('order-total')).toHaveTextContent('4.000.000');
    expect(screen.getByText('Thanh toán khi nhận hàng (COD)')).toBeInTheDocument();
    expect(screen.getByText('Giao hàng tiêu chuẩn')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    const step = screen.getByRole('list', { name: 'Các bước đặt hàng' });
    expect(within(step).getByText('2. Thanh toán').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );
  });

  it('giỏ trống → link mua sắm; lỗi tải → "Thử lại"', async () => {
    let fail = true;
    const { user } = setup({
      'GET /cart': () =>
        fail ? apiError(503, 'SERVICE_UNAVAILABLE', 'Hệ thống bận.') : json(cartOf([])),
    });
    expect(await screen.findByText('Không tải được đơn hàng')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Giỏ hàng đang trống')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Tiếp tục mua sắm/ })).toHaveAttribute(
      'href',
      '/san-pham',
    );
  });

  it('bỏ trống form → lỗi từng ô, focus ô đầu, không gọi API', async () => {
    const { user, api } = setup();
    await screen.findByText('Tai nghe AirPods');
    await user.click(placeButton());

    expect(screen.getByText('Vui lòng nhập họ tên người nhận.')).toBeInTheDocument();
    expect(screen.getByText('Vui lòng nhập số điện thoại.')).toBeInTheDocument();
    expect(screen.getByText('Vui lòng nhập địa chỉ chi tiết.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Họ và tên/ })).toHaveFocus();
    expect(api.to('POST /orders')).toHaveLength(0);
  });

  it('đặt thành công → POST đúng body + Idempotency-Key, sang trang xác nhận', async () => {
    const { user, api, location } = setup();
    await screen.findByText('Tai nghe AirPods');
    await fill(user);
    await user.click(screen.getByRole('textbox', { name: /Ghi chú/ }));
    await user.paste(' Gọi trước khi đến ');
    await user.click(placeButton());

    await waitFor(() => expect(location()).toBe(`/dat-hang-thanh-cong/${ORDER_ID}`));
    const [req] = api.to('POST /orders');
    expect(req!.body).toEqual({
      shipping: {
        recipientName: 'Nguyễn Văn Minh',
        phone: '0912345678',
        address: '123 Lê Lợi, Quận 1, Phường Bến Nghé, TP. Hồ Chí Minh',
        note: 'Gọi trước khi đến',
      },
    });
    expect(req!.headers['Idempotency-Key']).toMatch(KEY_PATTERN);
  });

  it('503 rồi bấm lại → CÙNG key; sửa form sau lỗi → key MỚI', async () => {
    let calls = 0;
    const { user, api } = setup({
      'POST /orders': () =>
        ++calls <= 2 ? apiError(503, 'ORDER_BUSY', 'Hệ thống đang đông.') : created(),
    });
    await screen.findByText('Tai nghe AirPods');
    await fill(user);

    await user.click(placeButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Hệ thống đang đông.');
    await user.click(placeButton());
    await waitFor(() => expect(api.to('POST /orders')).toHaveLength(2));
    await waitFor(() => expect(placeButton()).toBeEnabled());

    await user.type(screen.getByRole('textbox', { name: /Địa chỉ chi tiết/ }), ' A');
    await user.click(placeButton());
    await waitFor(() => expect(api.to('POST /orders')).toHaveLength(3));
    const [first, second, third] = api.to('POST /orders');
    expect(second!.headers['Idempotency-Key']).toBe(first!.headers['Idempotency-Key']);
    expect(third!.headers['Idempotency-Key']).not.toBe(first!.headers['Idempotency-Key']);
  });

  it('bấm đúp "Đặt hàng" → chỉ một request', async () => {
    const send = vi.fn<FakeHandler>(
      () => new Promise((resolve) => setTimeout(() => resolve(created()), 50)),
    );
    const { user, location } = setup({ 'POST /orders': send });
    await screen.findByText('Tai nghe AirPods');
    await fill(user);
    await user.dblClick(placeButton());
    await waitFor(() => expect(location()).toContain('/dat-hang-thanh-cong/'));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('409 OUT_OF_STOCK → thiếu hàng theo từng sản phẩm, chặn đặt, link về giỏ', async () => {
    const { user, api } = setup({
      'POST /orders': () =>
        apiError(409, 'OUT_OF_STOCK', 'Không đủ hàng.', [
          { productId: 2, sku: 'SF-2', name: 'Đồng hồ', requested: 2, available: 1 },
          { productId: 1, sku: 'SF-1', name: 'Tai nghe', requested: 2, available: 0 },
        ]),
    });
    await screen.findByText('Tai nghe AirPods');
    await fill(user);
    await user.click(placeButton());

    expect(await screen.findByText('Chỉ còn 1, bạn đặt 2.')).toBeInTheDocument();
    expect(screen.getByText('Đã hết hàng, bạn đặt 2.')).toBeInTheDocument();
    expect(placeButton()).toBeDisabled();
    expect(screen.getByRole('link', { name: /Cập nhật giỏ hàng/ })).toHaveAttribute(
      'href',
      '/gio-hang',
    );
    await waitFor(() => expect(api.to('GET /cart').length).toBeGreaterThanOrEqual(2));
  });

  it('giỏ đã thiếu hàng từ trước → chặn đặt, không gọi API', async () => {
    const { api } = setup({
      'GET /cart': () =>
        json(cartOf([line(1, 'Tai nghe AirPods', { available: 1, insufficientStock: true })])),
    });
    expect(await screen.findByText('Chỉ còn 1, bạn đặt 2.')).toBeInTheDocument();
    expect(placeButton()).toBeDisabled();
    expect(api.to('POST /orders')).toHaveLength(0);
  });
});
