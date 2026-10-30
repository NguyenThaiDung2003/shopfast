import { describe, expect, it } from 'vitest';
import {
  parseInventoryFilters,
  stockLevelOf,
  toInventorySearchParams,
  validateAdjustment,
  validateStockCount,
} from './inventory-filters';
import {
  parseOrderFilters,
  toOrderSearchParams,
  validateOrderSearch,
  validateStatusNote,
} from './orders-filters';
import { transitionActions } from './transition-view';

describe('orders-filters', () => {
  it('mặc định + đọc/ghi URL, bỏ giá trị sai', () => {
    expect(parseOrderFilters(new URLSearchParams())).toEqual({
      tab: 'all',
      q: undefined,
      page: 1,
      limit: 25,
    });
    const filters = parseOrderFilters(
      new URLSearchParams('status=SHIPPING&q=%20sf-1%20&page=3&limit=50'),
    );
    expect(filters).toEqual({ tab: 'SHIPPING', q: 'sf-1', page: 3, limit: 50 });
    expect(toOrderSearchParams(filters).toString()).toBe('status=SHIPPING&q=sf-1&page=3&limit=50');
    expect(parseOrderFilters(new URLSearchParams('status=LOST&page=0&limit=33'))).toMatchObject({
      tab: 'all',
      page: 1,
      limit: 25,
    });
  });

  it('ghi chú: bắt buộc khi huỷ, tối đa 500 ký tự; tìm kiếm ≤ 100', () => {
    expect(validateStatusNote('CANCELLED', '  ')).toBe('Vui lòng nhập lý do huỷ đơn.');
    expect(validateStatusNote('SHIPPING', '')).toBeUndefined();
    expect(validateStatusNote('SHIPPING', 'a'.repeat(501))).toBe('Ghi chú tối đa 500 ký tự.');
    expect(validateOrderSearch('a'.repeat(101)).error).toBe('Từ khoá tối đa 100 ký tự.');
  });

  it('nút chuyển trạng thái chỉ từ nextStatuses: bước tiến trước, huỷ sau', () => {
    expect(
      transitionActions(['CANCELLED', 'SHIPPING']).map((a) => [a.to, a.kind, a.label]),
    ).toEqual([
      ['SHIPPING', 'forward', 'Chuyển sang Đang giao'],
      ['CANCELLED', 'cancel', 'Huỷ đơn'],
    ]);
    expect(transitionActions([])).toEqual([]);
    expect(transitionActions(undefined)).toEqual([]);
  });
});

describe('inventory-filters', () => {
  it('đọc/ghi URL, bỏ giá trị sai', () => {
    const filters = parseInventoryFilters(
      new URLSearchParams('q=%20sam%20&categoryId=3&stockLevel=low&sort=sku&page=2&limit=50'),
    );
    expect(filters).toEqual({
      q: 'sam',
      categoryId: 3,
      stockLevel: 'low',
      sort: 'sku',
      page: 2,
      limit: 50,
    });
    expect(toInventorySearchParams(filters).toString()).toBe(
      'q=sam&categoryId=3&stockLevel=low&sort=sku&page=2&limit=50',
    );
    expect(
      parseInventoryFilters(new URLSearchParams('categoryId=0&stockLevel=few&sort=x&limit=7')),
    ).toEqual({
      q: undefined,
      categoryId: undefined,
      stockLevel: undefined,
      sort: 'stock_asc',
      page: 1,
      limit: 25,
    });
  });

  it('mức tồn theo ngưỡng API trả về', () => {
    expect(stockLevelOf(0, 5)).toMatchObject({ level: 'out', label: 'Hết hàng' });
    expect(stockLevelOf(4, 5)).toMatchObject({ level: 'low', label: 'Sắp hết (< 5 chiếc)' });
    expect(stockLevelOf(5, 5)).toMatchObject({ level: 'ok' });
    expect(stockLevelOf(14, 15)).toMatchObject({ level: 'low' });
  });

  it('kiểm kê: số nguyên 0 – 1.000.000', () => {
    expect(validateStockCount('20')).toEqual({ value: 20 });
    expect(validateStockCount('0')).toEqual({ value: 0 });
    expect(validateStockCount('-1').error).toBe('Nhập số lượng là số nguyên ≥ 0.');
    expect(validateStockCount('1.5').error).toBeDefined();
    expect(validateStockCount('1000001').error).toBe('Tồn kho tối đa 1.000.000.');
  });

  it('nhập/xuất kho và sửa giá', () => {
    const base = {
      price: '',
      compareAtPrice: '',
      imageUrl: '',
      current: { stock: 4, price: 100_000, compareAtPrice: null, imageUrl: null },
      canEditPrice: false,
    };
    expect(validateAdjustment({ ...base, direction: 'in', quantity: '10' }).patch).toEqual({
      stockDelta: 10,
    });
    expect(validateAdjustment({ ...base, direction: 'out', quantity: '3' }).patch).toEqual({
      stockDelta: -3,
    });
    expect(validateAdjustment({ ...base, direction: 'out', quantity: '5' }).errors.quantity).toBe(
      'Không thể xuất quá số đang tồn (4).',
    );
    expect(validateAdjustment({ ...base, direction: 'in', quantity: '0' }).errors.quantity).toBe(
      'Số lượng phải là số nguyên lớn hơn 0.',
    );
    expect(validateAdjustment({ ...base, direction: 'in', quantity: '' }).errors.form).toBe(
      'Nhập số lượng cần nhập hoặc xuất kho.',
    );
    // Không phải ADMIN: ô giá bị bỏ qua dù có giá trị.
    expect(
      validateAdjustment({ ...base, direction: 'in', quantity: '', price: '1' }).errors.form,
    ).toBeDefined();

    const admin = { ...base, canEditPrice: true, direction: 'in' as const, quantity: '' };
    expect(validateAdjustment({ ...admin, price: '120000' }).patch).toEqual({ price: 120_000 });
    expect(validateAdjustment({ ...admin, price: '100000' }).errors.form).toBe(
      'Nhập số lượng nhập/xuất hoặc thông tin cần đổi.',
    );
    expect(validateAdjustment({ ...admin, price: '2000000001' }).errors.price).toBe(
      'Giá tối đa 2.000.000.000 ₫.',
    );
    expect(validateAdjustment({ ...admin, price: '12a' }).errors.price).toBeDefined();
  });

  describe('giá gốc và ảnh', () => {
    const admin = {
      direction: 'in' as const,
      quantity: '',
      price: '100000',
      compareAtPrice: '',
      imageUrl: '',
      current: { stock: 4, price: 100_000, compareAtPrice: null, imageUrl: null },
      canEditPrice: true,
    };
    const stored = {
      ...admin,
      compareAtPrice: '150000',
      imageUrl: '/a.png',
      current: { ...admin.current, compareAtPrice: 150_000, imageUrl: '/a.png' },
    };
    const compareError = 'Giá gốc phải lớn hơn giá bán; để trống nếu không giảm giá.';

    it('chỉ gửi trường đã đổi; để trống là xoá', () => {
      expect(validateAdjustment({ ...admin, compareAtPrice: '150000' }).patch).toEqual({
        compareAtPrice: 150_000,
      });
      expect(validateAdjustment({ ...admin, imageUrl: ' /a.png ' }).patch).toEqual({
        imageUrl: '/a.png',
      });
      expect(validateAdjustment({ ...stored, compareAtPrice: '', imageUrl: '' }).patch).toEqual({
        compareAtPrice: null,
        imageUrl: null,
      });
      expect(validateAdjustment(stored).errors.form).toBeDefined();
    });

    it('giá gốc so với giá bán sau khi lưu', () => {
      expect(validateAdjustment({ ...admin, compareAtPrice: '100000' }).errors.compareAtPrice).toBe(
        compareError,
      );
      // Tăng giá vượt giá gốc đang có: phải sửa giá gốc, không để giảm giá ẩn đi im lặng.
      expect(validateAdjustment({ ...stored, price: '150000' }).errors.compareAtPrice).toBe(
        compareError,
      );
      expect(validateAdjustment({ ...stored, price: '150000', compareAtPrice: '' }).patch).toEqual({
        price: 150_000,
        compareAtPrice: null,
      });
      expect(validateAdjustment({ ...admin, compareAtPrice: '1a' }).errors.compareAtPrice).toBe(
        'Giá gốc phải là số nguyên (đồng).',
      );
      expect(
        validateAdjustment({ ...admin, compareAtPrice: '2000000001' }).errors.compareAtPrice,
      ).toBe('Giá tối đa 2.000.000.000 ₫.');
    });

    it('giá gốc cũ không còn hợp lệ không chặn việc nhập kho', () => {
      const stale = {
        ...stored,
        quantity: '5',
        price: '200000',
        compareAtPrice: '150000',
        current: { ...stored.current, price: 200_000 },
      };
      expect(validateAdjustment(stale).patch).toEqual({ stockDelta: 5 });
    });

    it('chỉ nhận đường dẫn ảnh an toàn', () => {
      for (const imageUrl of ['/images/a.png', 'https://cdn.example/a.png']) {
        expect(validateAdjustment({ ...admin, imageUrl }).patch).toEqual({ imageUrl });
      }
      for (const imageUrl of [
        'javascript:alert(1)',
        'http://example.com/a.png',
        '//evil.example/a.png',
        '/\\evil.example/a.png',
        '/a b.png',
        `/${'a'.repeat(500)}`,
      ]) {
        expect(validateAdjustment({ ...admin, imageUrl }).errors.imageUrl).toBeDefined();
      }
    });

    it('không phải ADMIN: bỏ qua các ô này', () => {
      expect(
        validateAdjustment({
          ...stored,
          canEditPrice: false,
          quantity: '1',
          compareAtPrice: '1',
          imageUrl: 'x',
        }).patch,
      ).toEqual({ stockDelta: 1 });
    });
  });
});
