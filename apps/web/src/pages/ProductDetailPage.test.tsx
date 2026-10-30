import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProductDetail } from '../products/product-api';
import { apiError, fakeApi, json, loginAs, type FakeHandler } from '../test/fake-api';
import { renderPage } from '../test/render';
import { ProductDetailPage } from './ProductDetailPage';

function detail(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: 42,
    sku: 'SF-AT-0042',
    name: 'Tai nghe Apple AirPods Pro 2',
    slug: 'tai-nghe-apple-airpods-pro-2',
    price: 5_490_000,
    stock: 14,
    category: { id: 4, name: 'Âm thanh', slug: 'am-thanh' },
    brand: { id: 1, name: 'Apple', slug: 'apple' },
    description: 'Chống ồn chủ động.\nPin 30 giờ.',
    updatedAt: '2026-10-30T07:35:00.000Z',
    ...overrides,
  };
}

function setup(
  route = '/san-pham/42',
  handlers: { product?: FakeHandler; addItem?: FakeHandler } = {},
) {
  const api = fakeApi({
    'GET /products/42': handlers.product ?? (() => json(detail())),
    'POST /cart/items': handlers.addItem ?? (() => json({ items: [] }, 201)),
  });
  const view = renderPage(<ProductDetailPage />, { route, path: '/san-pham/:id' });
  return { ...view, api };
}

const addButton = () => screen.getByRole('button', { name: /Thêm vào giỏ hàng/ });
const buyButton = () => screen.getByRole('button', { name: /Mua ngay/ });
const quantity = () => screen.getByRole('textbox', { name: 'Số lượng' });

describe('ProductDetailPage', () => {
  it('skeleton rồi hiện chi tiết: tên, giá, SKU, link thương hiệu/danh mục, tồn kho', async () => {
    const { api } = setup();
    expect(screen.getByRole('status', { name: 'Đang tải sản phẩm' })).toBeInTheDocument();

    const title = await screen.findByRole('heading', {
      level: 1,
      name: 'Tai nghe Apple AirPods Pro 2',
    });
    expect(title).toBeInTheDocument();
    expect(api.to('GET /products/42')).toHaveLength(1);
    expect(screen.getByText(/^5\.490\.000/).textContent).toBe('5.490.000 ₫');
    expect(screen.getByText('SF-AT-0042')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xem sản phẩm Apple' })).toHaveAttribute(
      'href',
      '/san-pham?brandId=1',
    );
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(breadcrumb).getByRole('link', { name: 'Âm thanh' })).toHaveAttribute(
      'href',
      '/san-pham?categoryId=4',
    );
    expect(within(breadcrumb).getByText('Tai nghe Apple AirPods Pro 2')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText('Còn 14 sản phẩm')).toBeInTheDocument();
    expect(document.title).toBe('Tai nghe Apple AirPods Pro 2 | ShopFast');
    expect(screen.getByText(/Chống ồn chủ động/)).toHaveTextContent(
      'Chống ồn chủ động. Pin 30 giờ.',
    );
  });

  it('id sai trên URL → không tìm thấy, không gọi API', async () => {
    const { api } = setup('/san-pham/abc');
    expect(await screen.findByText('Không tìm thấy sản phẩm')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Xem sản phẩm khác/ })).toHaveAttribute(
      'href',
      '/san-pham',
    );
    expect(api.requests).toHaveLength(0);
  });

  it('API 404 → không tìm thấy', async () => {
    setup('/san-pham/42', {
      product: () => apiError(404, 'PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm.'),
    });
    expect(await screen.findByText('Không tìm thấy sản phẩm')).toBeInTheDocument();
  });

  it('lỗi server → thông điệp + "Thử lại" gọi lại API', async () => {
    let fail = true;
    const { user, api } = setup('/san-pham/42', {
      product: () =>
        fail
          ? apiError(503, 'SERVICE_UNAVAILABLE', 'Hệ thống đang bận, vui lòng thử lại sau.')
          : json(detail()),
    });
    expect(await screen.findByText('Hệ thống đang bận, vui lòng thử lại sau.')).toBeInTheDocument();

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('AirPods');
    expect(api.to('GET /products/42')).toHaveLength(2);
  });

  it('số lượng: nút −/+ kẹp trong [1, tồn kho]; gõ sai → lỗi tiếng Việt và khoá nút mua', async () => {
    loginAs('CUSTOMER');
    const { user } = setup('/san-pham/42', { product: () => json(detail({ stock: 3 })) });
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByRole('button', { name: 'Giảm số lượng' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    await user.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    expect(quantity()).toHaveValue('3');
    expect(screen.getByRole('button', { name: 'Tăng số lượng' })).toBeDisabled();

    await user.clear(quantity());
    await user.type(quantity(), '5');
    expect(quantity()).toHaveAccessibleDescription('Chỉ còn 3 sản phẩm.');
    expect(addButton()).toBeDisabled();
    expect(buyButton()).toBeDisabled();

    await user.clear(quantity());
    await user.type(quantity(), '0');
    expect(quantity()).toHaveAccessibleDescription('Số lượng tối thiểu là 1.');

    await user.clear(quantity());
    expect(quantity()).toHaveAccessibleDescription('Số lượng phải là số nguyên từ 1.');

    await user.type(quantity(), '2');
    expect(quantity()).not.toHaveAttribute('aria-invalid');
    expect(addButton()).toBeEnabled();
  });

  it('khách hàng thêm 3 sản phẩm → POST /cart/items có token, toast', async () => {
    loginAs('CUSTOMER');
    const { user, api, location } = setup();
    await screen.findByRole('heading', { level: 1 });

    await user.clear(quantity());
    await user.type(quantity(), '3');
    await user.click(addButton());

    expect(await screen.findByText('Đã thêm vào giỏ hàng')).toBeInTheDocument();
    expect(screen.getByText('Tai nghe Apple AirPods Pro 2 × 3')).toBeInTheDocument();
    const [req] = api.to('POST /cart/items');
    expect(req!.body).toEqual({ productId: 42, quantity: 3 });
    expect(req!.headers.Authorization).toMatch(/^Bearer /);
    expect(location()).toBe('/san-pham/42');
  });

  it('"Mua ngay" → thêm vào giỏ rồi sang /gio-hang', async () => {
    loginAs('CUSTOMER');
    const { user, api, location } = setup();
    await screen.findByRole('heading', { level: 1 });

    await user.click(buyButton());
    expect(await screen.findByText('Trang khác')).toBeInTheDocument();
    expect(location()).toBe('/gio-hang');
    expect(api.to('POST /cart/items')[0]!.body).toEqual({ productId: 42, quantity: 1 });
  });

  it('server từ chối (409 vượt tồn kho khi cộng dồn giỏ) → toast lỗi, ở lại trang', async () => {
    loginAs('CUSTOMER');
    const { user, location } = setup('/san-pham/42', {
      addItem: () =>
        apiError(409, 'INSUFFICIENT_STOCK', 'Sản phẩm "AirPods" chỉ còn 14, không đủ 15.'),
    });
    await screen.findByRole('heading', { level: 1 });

    await user.click(buyButton());
    expect(await screen.findByText('Không thêm được vào giỏ hàng')).toBeInTheDocument();
    expect(screen.getByText('Sản phẩm "AirPods" chỉ còn 14, không đủ 15.')).toBeInTheDocument();
    expect(location()).toBe('/san-pham/42');
  });

  it('chưa đăng nhập → sang đăng nhập kèm next, không gọi API giỏ', async () => {
    const { user, api, location } = setup();
    await screen.findByRole('heading', { level: 1 });

    await user.click(addButton());
    expect(location()).toBe('/dang-nhap?next=%2Fsan-pham%2F42');
    expect(api.to('POST /cart/items')).toHaveLength(0);
  });

  it('hết hàng → ô số lượng và nút mua bị khoá', async () => {
    loginAs('CUSTOMER');
    setup('/san-pham/42', { product: () => json(detail({ stock: 0 })) });
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByRole('button', { name: /Tạm hết hàng/ })).toBeDisabled();
    expect(buyButton()).toBeDisabled();
    expect(quantity()).toBeDisabled();
    expect(screen.getByText('0 sản phẩm khả dụng')).toBeInTheDocument();
  });

  it('nhân viên chỉ xem, không có nút mua', async () => {
    loginAs('SUPPORT');
    setup();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText('Tài khoản nhân viên chỉ xem thông tin sản phẩm.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mua ngay/ })).not.toBeInTheDocument();
  });

  it('tab "Thông số kỹ thuật"; mô tả rỗng → "Chưa có mô tả"', async () => {
    const { user } = setup('/san-pham/42', {
      product: () => json(detail({ description: null })),
    });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText('Chưa có mô tả cho sản phẩm này')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Thông số kỹ thuật' }));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('Mã SKU').nextSibling).toHaveTextContent('SF-AT-0042');
    expect(within(panel).getByText('Thương hiệu').nextSibling).toHaveTextContent('Apple');
    expect(within(panel).getByText('Cập nhật lúc').nextSibling).toHaveTextContent(
      '14:35 30/10/2026',
    );
  });
});
