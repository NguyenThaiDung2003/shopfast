import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { parseHomeTab, topCategories } from '../products/home-products';
import type { CatalogFacet, Product, ProductPage } from '../products/product-api';
import { apiError, fakeApi, json, loginAs, type FakeHandler } from '../test/fake-api';
import { renderPage } from '../test/render';
import { HomePage } from './HomePage';

const category = (id: number, name: string, productCount: number): CatalogFacet => ({
  id,
  name,
  slug: `dm-${id}`,
  productCount,
});
const CATEGORIES = [
  category(1, 'Thời trang', 5),
  category(2, 'Điện thoại', 40),
  category(3, 'Gia dụng', 20),
  category(4, 'Trống', 0),
];

const product = (id: number, name: string, stock = 10): Product => ({
  id,
  sku: `SF-${id}`,
  name,
  slug: `sp-${id}`,
  price: 1_290_000,
  stock,
  category: { id: 2, name: 'Điện thoại', slug: 'dm-2' },
  brand: { id: 1, name: 'Sony', slug: 'sony' },
});
const page = (items: Product[]): ProductPage => ({
  items,
  meta: { page: 1, limit: 8, total: items.length, totalPages: 1 },
});

/** Sản phẩm khác nhau theo `sort` để biết khối nào dùng dữ liệu nào. */
const byLimit: FakeHandler = (req) =>
  json(
    page([
      req.query.get('limit') === '4'
        ? product(1, 'Cáp giá tốt')
        : product(2, `Gợi ý ${req.query.get('sort')}`),
    ]),
  );

function setup(routes: Record<string, FakeHandler> = {}, route = '/') {
  const api = fakeApi({
    'GET /categories': () => json(CATEGORIES),
    'GET /products': byLimit,
    'POST /cart/items': () => json({ items: [] }, 201),
    ...routes,
  });
  return { ...renderPage(<HomePage />, { route, path: '/' }), api };
}

describe('home-products', () => {
  it('tab sai về mặc định; danh mục nổi bật theo số sản phẩm, bỏ danh mục rỗng', () => {
    expect(parseHomeTab('price_asc')).toBe('price_asc');
    expect(parseHomeTab('hack')).toBe('newest');
    expect(parseHomeTab(null)).toBe('newest');
    expect(topCategories(CATEGORIES, 2).map((c) => c.id)).toEqual([2, 3]);
    expect(topCategories([category(9, 'Trống', 0)], 2)).toEqual([]);
  });
});

describe('HomePage', () => {
  it('hiện danh mục, thẻ nổi bật, sản phẩm thật và link đúng', async () => {
    const { api } = setup();
    expect(screen.getByRole('status', { name: 'Đang tải danh mục' })).toBeInTheDocument();

    expect(await screen.findByRole('link', { name: 'Danh mục Điện thoại' })).toHaveAttribute(
      'href',
      '/san-pham?categoryId=2',
    );
    expect(screen.getByRole('link', { name: 'Danh mục Gia dụng' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Danh mục Thời trang' })).not.toBeInTheDocument();

    const chips = screen.getByRole('region', { name: 'Danh mục nổi bật' });
    expect(within(chips).getByRole('link', { name: /Tất cả/ })).toHaveAttribute(
      'href',
      '/san-pham',
    );
    expect(within(chips).getByRole('link', { name: /Thời trang/ })).toBeInTheDocument();

    const best = screen.getByRole('region', { name: 'Giá tốt hôm nay' });
    expect(await within(best).findByText('Cáp giá tốt')).toBeInTheDocument();
    expect(best).toHaveTextContent('1.290.000');
    const queries = api.to('GET /products').map((r) => Object.fromEntries(r.query));
    expect(queries).toContainEqual({ sort: 'price_asc', limit: '4' });
    expect(queries).toContainEqual({ sort: 'newest', limit: '8' });
  });

  it('đổi tab ghi URL, gửi đúng sort, link "Xem thêm" theo tab', async () => {
    const { user, location } = setup();
    const section = screen.getByRole('region', { name: 'Gợi ý hôm nay' });
    await within(section).findByText('Gợi ý newest');

    await user.click(screen.getByRole('tab', { name: 'Giá tốt' }));
    expect(location()).toBe('/?tab=price_asc');
    expect(await within(section).findByText('Gợi ý price_asc')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: /Xem thêm sản phẩm/ })).toHaveAttribute(
      'href',
      '/san-pham?sort=price_asc',
    );

    await user.click(screen.getByRole('tab', { name: 'Mới nhất' }));
    expect(location()).toBe('/');
  });

  it('?tab= sai → dùng tab mặc định', async () => {
    setup({}, '/?tab=hack');
    expect(screen.getByRole('tab', { name: 'Mới nhất' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Gợi ý newest')).toBeInTheDocument();
  });

  it('khách vãng lai thêm giỏ → sang đăng nhập; khách hàng → POST /cart/items', async () => {
    const guest = setup();
    await guest.user.click(await screen.findByRole('button', { name: 'Thêm Cáp giá tốt vào giỏ' }));
    expect(guest.location()).toContain('/dang-nhap?next=');
  });

  it('khách hàng thêm vào giỏ gọi API', async () => {
    loginAs('CUSTOMER');
    const { user, api } = setup();
    await user.click(await screen.findByRole('button', { name: 'Thêm Cáp giá tốt vào giỏ' }));
    await waitFor(() => expect(api.to('POST /cart/items')).toHaveLength(1));
    expect(api.to('POST /cart/items')[0]!.body).toEqual({ productId: 1, quantity: 1 });
  });

  it('thẻ sản phẩm: ảnh, giá gốc, % giảm, số đã bán; ảnh lỗi về icon; thiếu dữ liệu thì ẩn', async () => {
    setup({
      'GET /products': (req) =>
        json(
          page([
            req.query.get('limit') === '4'
              ? {
                  ...product(1, 'Tai nghe giảm'),
                  price: 760_000,
                  compareAtPrice: 1_000_000,
                  soldCount: 1_400,
                  imageUrl: '/images/products/am-thanh.svg',
                }
              : product(2, 'Cáp thường'),
          ]),
        ),
    });
    const best = screen.getByRole('region', { name: 'Giá tốt hôm nay' });
    const image = await within(best).findByRole('img', { name: 'Tai nghe giảm', hidden: true });
    expect(image).toHaveAttribute('src', '/images/products/am-thanh.svg');
    expect(best).toHaveTextContent('1.000.000');
    expect(best).toHaveTextContent('-24%');
    expect(best).toHaveTextContent('Đã bán 1,4k');

    fireEvent.error(image);
    expect(within(best).queryByRole('img', { hidden: true })).not.toBeInTheDocument();

    const other = screen.getByRole('region', { name: 'Gợi ý hôm nay' });
    await within(other).findByText('Cáp thường');
    expect(other).not.toHaveTextContent('Đã bán');
    expect(other).not.toHaveTextContent('%');
  });

  it('hết hàng → không cho mua', async () => {
    setup({ 'GET /products': () => json(page([product(5, 'Tai nghe hết', 0)])) });
    expect((await screen.findAllByText('Tai nghe hết')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Thêm Tai nghe hết/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Tạm hết hàng/ })[0]).toBeDisabled();
  });

  it('một khối lỗi không ảnh hưởng khối khác; "Thử lại" tải lại', async () => {
    let fail = true;
    const { user } = setup({
      'GET /categories': () =>
        fail ? apiError(503, 'SERVICE_UNAVAILABLE', 'Hệ thống bận.') : json(CATEGORIES),
    });
    expect(await screen.findByText('Không tải được danh mục')).toBeInTheDocument();
    expect(await screen.findByText('Cáp giá tốt')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('link', { name: 'Danh mục Điện thoại' })).toBeInTheDocument();
  });

  it('chưa có sản phẩm → thông báo rỗng', async () => {
    setup({ 'GET /products': () => json(page([])) });
    expect((await screen.findAllByText('Chưa có sản phẩm nào')).length).toBe(2);
  });
});
