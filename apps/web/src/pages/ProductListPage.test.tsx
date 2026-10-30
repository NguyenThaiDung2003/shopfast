import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CatalogFacet, Product, ProductPage } from '../products/product-api';
import { apiError, fakeApi, json, loginAs, type FakeHandler } from '../test/fake-api';
import { renderPage } from '../test/render';
import { ProductListPage } from './ProductListPage';

const CATEGORIES: CatalogFacet[] = [
  { id: 1, name: 'Điện thoại', slug: 'dien-thoai', productCount: 45 },
  { id: 2, name: 'Âm thanh', slug: 'am-thanh', productCount: 32 },
];
const BRANDS: CatalogFacet[] = [
  { id: 10, name: 'Apple', slug: 'apple', productCount: 36 },
  { id: 11, name: 'Sony', slug: 'sony', productCount: 24 },
];

function product(id: number, name: string, price: number, stock: number): Product {
  return {
    id,
    sku: `SF-${id}`,
    name,
    slug: `sp-${id}`,
    price,
    stock,
    category: { id: 2, name: 'Âm thanh', slug: 'am-thanh' },
    brand: { id: 11, name: 'Sony', slug: 'sony' },
  };
}

const PRODUCTS = [
  product(1, 'Tai nghe Sony WH-1000XM5', 1_290_000, 50),
  product(2, 'Loa Sony SRS-XB100', 990_000, 2),
  product(3, 'Tai nghe Sony Pro', 2_490_000, 0),
];

function page(items: Product[], total: number, pageNo = 1): ProductPage {
  return { items, meta: { page: pageNo, limit: 12, total, totalPages: Math.ceil(total / 12) } };
}

function setup(route = '/san-pham', products: FakeHandler = () => json(page(PRODUCTS, 30))) {
  const api = fakeApi({
    'GET /products': products,
    'GET /categories': () => json(CATEGORIES),
    'GET /brands': () => json(BRANDS),
    'POST /cart/items': () => json({ items: [] }, 201),
  });
  const view = renderPage(<ProductListPage />, { route, path: '/san-pham' });
  return { ...view, api };
}

const card = (name: string) =>
  screen.getByRole('heading', { name }).closest('[data-testid="product-card"]') as HTMLElement;

describe('ProductListPage', () => {
  it('skeleton khi tải, rồi hiện thẻ sản phẩm với giá và trạng thái kho', async () => {
    setup();
    expect(screen.getByRole('status', { name: 'Đang tải sản phẩm' })).toBeInTheDocument();

    expect(
      await screen.findByRole('heading', { name: 'Tai nghe Sony WH-1000XM5' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Tìm thấy', { exact: false })).toHaveTextContent(
      'Tìm thấy 30 sản phẩm',
    );

    const first = card('Tai nghe Sony WH-1000XM5');
    // Giữ khoảng trắng không ngắt dòng trước ₫ (Testing Library chuẩn hoá NBSP khi so khớp).
    expect(within(first).getByText(/^1\.290\.000/).textContent).toBe('1.290.000\u00A0₫');
    expect(within(first).getByText('Còn hàng')).toBeInTheDocument();
    expect(within(card('Loa Sony SRS-XB100')).getByText('Sắp hết (còn 2)')).toBeInTheDocument();
    expect(
      within(card('Tai nghe Sony Pro')).getByRole('button', { name: /Tạm hết hàng/ }),
    ).toBeDisabled();
    expect(screen.getByRole('navigation', { name: 'Phân trang' })).toHaveTextContent(
      'Hiển thị 1 - 12 trong số 30 sản phẩm',
    );
  });

  it('đọc bộ lọc từ URL: gửi đúng query, điền sẵn form, hiện chip và tiêu đề danh mục', async () => {
    const { api } = setup('/san-pham?categoryId=1&minPrice=500000&maxPrice=2000000&sort=price_asc');

    await screen.findByRole('heading', { name: 'Tai nghe Sony WH-1000XM5' });
    const query = Object.fromEntries(api.to('GET /products')[0]!.query);
    expect(query).toEqual({
      categoryId: '1',
      minPrice: '500000',
      maxPrice: '2000000',
      sort: 'price_asc',
      page: '1',
      limit: '12',
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Điện thoại' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Danh mục: Điện thoại')).toBeInTheDocument();
    expect(screen.getByText('Giá: 500k - 2tr')).toBeInTheDocument();
    expect(screen.getByLabelText('Tối thiểu')).toHaveValue('500.000');
    expect(screen.getByLabelText('Tối đa')).toHaveValue('2.000.000');
    expect(screen.getByRole('radio', { name: /Điện thoại/ })).toBeChecked();
    expect(screen.getByLabelText('Sắp xếp theo')).toHaveValue('price_asc');
  });

  it('chọn thương hiệu + khoảng giá nhanh rồi Áp dụng → ghi URL, về trang 1', async () => {
    const { user, location } = setup('/san-pham?page=3&sort=price_desc');
    await screen.findByRole('radio', { name: /Sony/ });

    await user.click(screen.getByRole('radio', { name: /Sony/ }));
    await user.click(screen.getByRole('button', { name: '1tr - 5tr' }));
    expect(location()).toBe('/san-pham?page=3&sort=price_desc'); // nháp, chưa áp dụng

    await user.click(screen.getByRole('button', { name: 'Áp dụng bộ lọc' }));
    expect(location()).toBe(
      '/san-pham?brandId=11&minPrice=1000000&maxPrice=5000000&sort=price_desc',
    );
  });

  it('validate giá: lỗi tiếng Việt, không đổi URL, không gọi lại API', async () => {
    const { user, location, api } = setup();
    await screen.findByRole('heading', { name: 'Tai nghe Sony WH-1000XM5' });
    const calls = api.to('GET /products').length;

    await user.type(screen.getByLabelText('Tối thiểu'), '5000000');
    await user.type(screen.getByLabelText('Tối đa'), '1000000');
    await user.click(screen.getByRole('button', { name: 'Áp dụng bộ lọc' }));

    expect(screen.getByLabelText('Tối đa')).toHaveAccessibleDescription(
      'Giá tối đa phải lớn hơn hoặc bằng giá tối thiểu.',
    );
    expect(screen.getByLabelText('Tối đa')).toHaveAttribute('aria-invalid', 'true');
    expect(location()).toBe('/san-pham');

    await user.clear(screen.getByLabelText('Tối thiểu'));
    await user.type(screen.getByLabelText('Tối thiểu'), '12abc');
    await user.click(screen.getByRole('button', { name: 'Áp dụng bộ lọc' }));
    expect(screen.getByLabelText('Tối thiểu')).toHaveAccessibleDescription(
      'Giá phải là số nguyên không âm.',
    );
    expect(location()).toBe('/san-pham');
    expect(api.to('GET /products')).toHaveLength(calls);
  });

  it('bấm × trên chip bỏ bộ lọc ngay; "Xoá bộ lọc" giữ sắp xếp', async () => {
    const { user, location } = setup(
      '/san-pham?categoryId=1&brandId=11&minPrice=500000&sort=name_asc',
    );
    await screen.findByText('Giá: từ 500k');

    await user.click(screen.getByRole('button', { name: 'Bỏ lọc Giá: từ 500k' }));
    expect(location()).toBe('/san-pham?categoryId=1&brandId=11&sort=name_asc');

    await user.click(screen.getByRole('button', { name: 'Xoá bộ lọc' }));
    expect(location()).toBe('/san-pham?sort=name_asc');
  });

  it('đổi sắp xếp, chuyển trang, đổi kiểu hiển thị → URL', async () => {
    const { user, location, api } = setup('/san-pham?categoryId=2', ({ query }) =>
      json(page(PRODUCTS, 30, Number(query.get('page')))),
    );
    await screen.findByRole('heading', { name: 'Tai nghe Sony WH-1000XM5' });

    await user.click(screen.getByRole('button', { name: '2' }));
    expect(location()).toBe('/san-pham?categoryId=2&page=2');
    await waitFor(() => expect(api.to('GET /products').at(-1)!.query.get('page')).toBe('2'));
    expect(window.scrollTo).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Dạng danh sách' }));
    expect(location()).toBe('/san-pham?categoryId=2&page=2&view=list');

    await user.selectOptions(screen.getByLabelText('Sắp xếp theo'), 'price_desc');
    expect(location()).toBe('/san-pham?categoryId=2&sort=price_desc&view=list');
  });

  it('không có kết quả → trạng thái rỗng với nút Xoá bộ lọc', async () => {
    const { user, location } = setup('/san-pham?brandId=10&maxPrice=1000', () => json(page([], 0)));

    expect(await screen.findByText('Không tìm thấy sản phẩm phù hợp')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Phân trang' })).not.toBeInTheDocument();
    const results = screen.getByRole('region', { name: 'Kết quả' });
    await user.click(within(results).getByRole('button', { name: 'Xoá bộ lọc' }));
    expect(location()).toBe('/san-pham');
  });

  it('lỗi server → thông điệp tiếng Việt, "Thử lại" gọi lại API', async () => {
    let fail = true;
    const { user, api } = setup('/san-pham', () =>
      fail
        ? apiError(503, 'SERVICE_UNAVAILABLE', 'Hệ thống đang bận, vui lòng thử lại sau.')
        : json(page(PRODUCTS, 3)),
    );

    expect(await screen.findByText('Không tải được danh sách sản phẩm')).toBeInTheDocument();
    expect(screen.getByText('Hệ thống đang bận, vui lòng thử lại sau.')).toBeInTheDocument();

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(
      await screen.findByRole('heading', { name: 'Tai nghe Sony WH-1000XM5' }),
    ).toBeInTheDocument();
    expect(api.to('GET /products')).toHaveLength(2);
  });

  it('lỗi tải danh mục chỉ ảnh hưởng nhóm lọc đó', async () => {
    fakeApi({
      'GET /products': () => json(page(PRODUCTS, 3)),
      'GET /categories': () => apiError(500, 'INTERNAL', 'Lỗi'),
      'GET /brands': () => json(BRANDS),
    });
    renderPage(<ProductListPage />, { route: '/san-pham', path: '/san-pham' });

    expect(await screen.findByText('Không tải được danh mục.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tai nghe Sony WH-1000XM5' })).toBeInTheDocument();
  });

  describe('Thêm vào giỏ', () => {
    it('chưa đăng nhập → chuyển trang đăng nhập kèm next', async () => {
      const { user, location, api } = setup('/san-pham?categoryId=2');
      await user.click(
        await screen.findByRole('button', { name: 'Thêm Tai nghe Sony WH-1000XM5 vào giỏ' }),
      );

      expect(location()).toBe('/dang-nhap?next=%2Fsan-pham%3FcategoryId%3D2');
      expect(api.to('POST /cart/items')).toHaveLength(0);
    });

    it('khách hàng → POST /cart/items có token, toast thành công', async () => {
      loginAs('CUSTOMER');
      const { user, api } = setup();
      await user.click(
        await screen.findByRole('button', { name: 'Thêm Loa Sony SRS-XB100 vào giỏ' }),
      );

      expect(await screen.findByText('Đã thêm vào giỏ hàng')).toBeInTheDocument();
      const [req] = api.to('POST /cart/items');
      expect(req!.body).toEqual({ productId: 2, quantity: 1 });
      expect(req!.headers.Authorization).toMatch(/^Bearer /);
    });

    it('API báo hết hàng (409) → toast lỗi với thông điệp từ server', async () => {
      loginAs('CUSTOMER');
      fakeApi({
        'GET /products': () => json(page(PRODUCTS, 3)),
        'GET /categories': () => json(CATEGORIES),
        'GET /brands': () => json(BRANDS),
        'POST /cart/items': () =>
          apiError(409, 'INSUFFICIENT_STOCK', 'Sản phẩm không đủ tồn kho (còn 0).'),
      });
      const { user } = renderPage(<ProductListPage />, { route: '/san-pham', path: '/san-pham' });
      await user.click(
        await screen.findByRole('button', { name: 'Thêm Loa Sony SRS-XB100 vào giỏ' }),
      );

      expect(await screen.findByText('Không thêm được vào giỏ hàng')).toBeInTheDocument();
      expect(screen.getByText('Sản phẩm không đủ tồn kho (còn 0).')).toBeInTheDocument();
    });

    it('nhân viên không thấy nút thêm vào giỏ', async () => {
      loginAs('WAREHOUSE');
      setup();
      await screen.findByRole('heading', { name: 'Tai nghe Sony WH-1000XM5' });
      expect(screen.queryByRole('button', { name: /vào giỏ/ })).not.toBeInTheDocument();
    });
  });

  it('từ khoá q (chưa hỗ trợ) → thông báo và nút bỏ từ khoá', async () => {
    const { user, location } = setup('/san-pham?q=tai%20nghe');
    expect(await screen.findByText(/chưa được hỗ trợ/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bỏ từ khoá' }));
    expect(location()).toBe('/san-pham');
  });
});
