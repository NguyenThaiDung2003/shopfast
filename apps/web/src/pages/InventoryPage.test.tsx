import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, fakeApi, json, loginAs, type FakeHandler } from '../test/fake-api';
import { renderPage } from '../test/render';
import type { InventoryItem, InventoryPage as Page } from '../warehouse/warehouse-api';
import { InventoryPage } from './InventoryPage';

const PATH = '/quan-tri/kho/ton-kho';
const cat = { id: 3, name: 'Đồng hồ thông minh', slug: 'dong-ho' };
const brand = { id: 1, name: 'Samsung', slug: 'samsung' };

function item(id: number, sku: string, stock: number, price = 6_990_000): InventoryItem {
  return {
    id,
    sku,
    name: `Sản phẩm ${sku}`,
    slug: sku.toLowerCase(),
    price,
    stock,
    imageUrl: null,
    compareAtPrice: null,
    category: cat,
    brand,
    updatedAt: '2024-10-24T07:30:00.000Z',
  };
}

const OUT = item(1, 'SAM-W6-00', 0);
const LOW = item(2, 'SAM-W6-44', 2);
const OK = item(3, 'APP-AP2', 48, 5_490_000);

function page(items: InventoryItem[]): Page {
  return {
    items,
    meta: { page: 1, limit: 25, total: items.length, totalPages: 1 },
    summary: {
      totalSkus: 3420,
      lowStock: 14,
      outOfStock: 3,
      stockValue: 12_450_000_000,
      lowStockThreshold: 5,
    },
  };
}

function setup(route = PATH, routes: Record<string, FakeHandler> = {}) {
  const api = fakeApi({
    'GET /products/inventory': () => json(page([OUT, LOW, OK])),
    'GET /categories': () => json([{ ...cat, productCount: 12 }]),
    ...routes,
  });
  const view = renderPage(<InventoryPage />, { route, path: PATH });
  return {
    ...view,
    api,
    lastQuery: () => Object.fromEntries(api.to('GET /products/inventory').at(-1)!.query),
  };
}

const row = async (sku: string) => (await screen.findByText(sku)).closest('tr') as HTMLElement;

describe('InventoryPage', () => {
  beforeEach(() => loginAs('WAREHOUSE'));

  it('thẻ thống kê từ summary; mức tồn theo ngưỡng API; dòng cảnh báo', async () => {
    const { lastQuery } = setup();
    expect(screen.getByRole('status', { name: 'Đang tải số liệu tồn kho' })).toBeInTheDocument();
    expect(await screen.findByText('Cảnh báo sắp hết (< 5 chiếc)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cảnh báo sắp hết.*14/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Đã hết hàng.*3/ })).toBeInTheDocument();
    expect(screen.getByText('Giá trị tồn kho (theo giá bán)')).toBeInTheDocument();
    expect(lastQuery()).toMatchObject({ sort: 'stock_asc', page: '1', limit: '25' });

    const out = await row('SAM-W6-00');
    expect(out).toHaveTextContent('Ưu tiên nhập gấp');
    expect(out).toHaveTextContent('Hết hàng');
    expect(out).toHaveClass('bg-error-container/20');
    expect(await row('SAM-W6-44')).toHaveTextContent('Sắp hết (< 5 chiếc)');
    const ok = await row('APP-AP2');
    expect(ok).toHaveTextContent('Còn hàng');
    expect(ok).not.toHaveClass('bg-error-container/20');
    expect(ok).toHaveTextContent('5.490.000');
  });

  it('bộ lọc: tìm SKU, danh mục, mức tồn (cả thẻ cảnh báo); chip và xoá bộ lọc', async () => {
    const { user, location, lastQuery } = setup();
    await row('APP-AP2');

    await user.type(screen.getByRole('searchbox', { name: /Tìm theo SKU/ }), 'sam{Enter}');
    expect(location()).toBe(`${PATH}?q=sam`);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Danh mục' }), '3');
    await user.click(screen.getByRole('button', { name: /Cảnh báo sắp hết/ }));
    expect(location()).toBe(`${PATH}?q=sam&categoryId=3&stockLevel=low`);
    await waitFor(() =>
      expect(lastQuery()).toMatchObject({ q: 'sam', categoryId: '3', stockLevel: 'low' }),
    );
    expect(screen.getByText('Danh mục: Đồng hồ thông minh')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Bỏ lọc Từ khoá/ }));
    expect(location()).toBe(`${PATH}?categoryId=3&stockLevel=low`);
    await user.click(screen.getByRole('button', { name: 'Xoá tất cả bộ lọc' }));
    expect(location()).toBe(PATH);
  });

  it('kiểm kê tại dòng: validate; Lưu gửi PATCH { stock }', async () => {
    const patch = vi.fn<FakeHandler>(() => json({ ...LOW, stock: 20 }));
    const { user } = setup(PATH, { 'PATCH /products/2': patch });
    const r = await row('SAM-W6-44');
    await user.click(within(r).getByRole('button', { name: 'Kiểm kê SAM-W6-44' }));

    const input = within(r).getByRole('textbox', { name: 'Số tồn thực tế SAM-W6-44' });
    await user.clear(input);
    await user.type(input, 'abc');
    await user.click(within(r).getByRole('button', { name: 'Lưu' }));
    expect(within(r).getByText('Nhập số lượng là số nguyên ≥ 0.')).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, '20{Enter}');
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]![0].body).toEqual({ stock: 20, expectedStock: 2 });
    expect(await screen.findByText('Đã cập nhật tồn kho SAM-W6-44')).toBeInTheDocument();
    expect(screen.getByText('2 → 20 chiếc.')).toBeInTheDocument();
    expect(within(r).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('kiểm kê: tồn vừa đổi (409 STOCK_CHANGED) → báo lỗi, giữ ô nhập, lần lưu sau dùng số mới', async () => {
    let stock = 2;
    const patch = vi.fn<FakeHandler>((req) => {
      const body = req.body as { stock: number; expectedStock: number };
      if (body.expectedStock !== stock) {
        return apiError(409, 'STOCK_CHANGED', 'Tồn kho vừa thay đổi, hiện còn 1.', { current: 1 });
      }
      stock = body.stock;
      return json({ ...LOW, stock });
    });
    const { user } = setup(PATH, {
      'GET /products/inventory': () => json(page([{ ...LOW, stock }])),
      'PATCH /products/2': patch,
    });
    const r = await row('SAM-W6-44');
    await user.click(within(r).getByRole('button', { name: 'Kiểm kê SAM-W6-44' }));
    stock = 1; // đơn khác trừ kho trong lúc đang đếm
    const input = within(r).getByRole('textbox', { name: 'Số tồn thực tế SAM-W6-44' });
    await user.clear(input);
    await user.type(input, '20{Enter}');

    expect(await within(r).findByText('Tồn kho vừa thay đổi, hiện còn 1.')).toBeInTheDocument();
    expect(input).toHaveValue('20');
    expect(patch.mock.calls[0]![0].body).toEqual({ stock: 20, expectedStock: 2 });

    await waitFor(async () => {
      await user.click(within(r).getByRole('button', { name: 'Lưu' }));
      expect(patch.mock.calls.at(-1)![0].body).toEqual({ stock: 20, expectedStock: 1 });
    });
    expect(await screen.findByText('Đã cập nhật tồn kho SAM-W6-44')).toBeInTheDocument();
  });

  it('nhập/xuất kho: xuất quá tồn báo lỗi; nhập +10 gửi stockDelta; 409 hiện dưới ô số lượng', async () => {
    let calls = 0;
    const patch = vi.fn<FakeHandler>(() =>
      ++calls === 1
        ? apiError(409, 'INSUFFICIENT_STOCK', 'Tồn kho không đủ: hiện còn 1, không thể trừ 2.')
        : json({ ...LOW, stock: 12 }),
    );
    const { user } = setup(PATH, { 'PATCH /products/2': patch });
    const r = await row('SAM-W6-44');
    await user.click(within(r).getByRole('button', { name: 'Nhập/Xuất SAM-W6-44' }));
    const dialog = screen.getByRole('dialog', { name: 'Điều chỉnh tồn kho' });
    expect(within(dialog).queryByRole('textbox', { name: /Giá bán/ })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('radio', { name: /Xuất kho/ }));
    const qty = within(dialog).getByRole('textbox', { name: 'Số lượng xuất' });
    await user.type(qty, '3');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu điều chỉnh' }));
    expect(within(dialog).getByText('Không thể xuất quá số đang tồn (2).')).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();

    await user.clear(qty);
    await user.type(qty, '2');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu điều chỉnh' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]![0].body).toEqual({ stockDelta: -2 });
    expect(
      await within(dialog).findByText('Tồn kho không đủ: hiện còn 1, không thể trừ 2.'),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole('radio', { name: /Nhập kho/ }));
    const inQty = within(dialog).getByRole('textbox', { name: 'Số lượng nhập' });
    await user.clear(inQty);
    await user.type(inQty, '10');
    expect(dialog).toHaveTextContent('Tồn sau điều chỉnh: 12 chiếc');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu điều chỉnh' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
    expect(patch.mock.calls[1]![0].body).toEqual({ stockDelta: 10 });
    expect(await screen.findByText('Đã cập nhật SAM-W6-44')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ADMIN sửa được giá → PATCH { price }', async () => {
    loginAs('ADMIN');
    const patch = vi.fn<FakeHandler>(() => json({ ...OK, price: 5_190_000 }));
    const { user } = setup(PATH, { 'PATCH /products/3': patch });
    const r = await row('APP-AP2');
    await user.click(within(r).getByRole('button', { name: 'Nhập/Xuất APP-AP2' }));
    const dialog = screen.getByRole('dialog');
    const price = within(dialog).getByRole('textbox', { name: /Giá bán/ });
    expect(price).toHaveValue('5490000');
    await user.clear(price);
    await user.type(price, '5190000');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu điều chỉnh' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]![0].body).toEqual({ price: 5_190_000 });
  });

  it('nhân viên kho không thấy ô giá gốc và ảnh', async () => {
    const { user } = setup();
    const r = await row('APP-AP2');
    await user.click(within(r).getByRole('button', { name: 'Nhập/Xuất APP-AP2' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('textbox', { name: /Giá gốc/ })).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('textbox', { name: /Đường dẫn ảnh/ }),
    ).not.toBeInTheDocument();
  });

  it('ADMIN sửa giá gốc và ảnh; lỗi 400 từ API hiện dưới ô giá gốc', async () => {
    loginAs('ADMIN');
    let calls = 0;
    const patch = vi.fn<FakeHandler>(() =>
      ++calls === 1
        ? apiError(400, 'INVALID_COMPARE_AT_PRICE', 'Giá gốc phải lớn hơn giá bán.')
        : json(OK),
    );
    const { user } = setup(PATH, {
      'GET /products/inventory': () =>
        json(page([{ ...OK, compareAtPrice: 6_000_000, imageUrl: '/images/cu.png' }])),
      'PATCH /products/3': patch,
    });
    const r = await row('APP-AP2');
    expect(within(r).getByRole('img', { name: 'Sản phẩm APP-AP2' })).toHaveAttribute(
      'src',
      '/images/cu.png',
    );
    await user.click(within(r).getByRole('button', { name: 'Nhập/Xuất APP-AP2' }));
    const dialog = screen.getByRole('dialog');
    const compareAt = within(dialog).getByRole('textbox', { name: /Giá gốc/ });
    const image = within(dialog).getByRole('textbox', { name: /Đường dẫn ảnh/ });
    expect(compareAt).toHaveValue('6000000');
    expect(image).toHaveValue('/images/cu.png');

    await user.clear(compareAt);
    await user.type(compareAt, '5000000');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu điều chỉnh' }));
    expect(
      within(dialog).getByText('Giá gốc phải lớn hơn giá bán; để trống nếu không giảm giá.'),
    ).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();

    await user.clear(compareAt);
    await user.type(compareAt, '7000000');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu điều chỉnh' }));
    expect(await within(dialog).findByText('Giá gốc phải lớn hơn giá bán.')).toBeInTheDocument();
    expect(patch.mock.calls[0]![0].body).toEqual({ compareAtPrice: 7_000_000 });

    await user.clear(compareAt);
    await user.clear(image);
    await user.click(within(dialog).getByRole('button', { name: 'Lưu điều chỉnh' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
    expect(patch.mock.calls[1]![0].body).toEqual({ compareAtPrice: null, imageUrl: null });
    expect(await screen.findByText('Đã cập nhật APP-AP2')).toBeInTheDocument();
    expect(screen.getByText('giá gốc; ảnh')).toBeInTheDocument();
  });

  it('lỗi tải → "Thử lại"; lọc không khớp → "Xoá bộ lọc"', async () => {
    let fail = true;
    const { user, location } = setup(`${PATH}?stockLevel=out`, {
      'GET /products/inventory': (req) =>
        fail
          ? apiError(503, 'SERVICE_UNAVAILABLE', 'Hệ thống đang bận.')
          : json(page(req.query.get('stockLevel') ? [] : [OK])),
    });
    expect(await screen.findByText('Không tải được tồn kho')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Không có sản phẩm phù hợp')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Xoá bộ lọc' }));
    expect(location()).toBe(PATH);
    expect(await screen.findByText('APP-AP2')).toBeInTheDocument();
  });
});
