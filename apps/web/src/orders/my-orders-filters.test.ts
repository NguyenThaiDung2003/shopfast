import { describe, expect, it } from 'vitest';
import {
  parseOrderFilters,
  tabCount,
  toOrderSearchParams,
  validateSearch,
  type StatusCounts,
} from './my-orders-filters';

const parse = (qs: string) => parseOrderFilters(new URLSearchParams(qs));

const COUNTS: StatusCounts = {
  PENDING_PAYMENT: 1,
  PAID: 2,
  PROCESSING: 3,
  SHIPPING: 4,
  DELIVERED: 5,
  CANCELLED: 6,
};

describe('parseOrderFilters / toOrderSearchParams', () => {
  it('mặc định: tab Tất cả, trang 1, không từ khoá', () => {
    expect(parse('')).toEqual({ tab: 'all', q: undefined, page: 1 });
    expect(toOrderSearchParams(parse('')).toString()).toBe('');
  });

  it('đọc tab, từ khoá (trim), trang', () => {
    expect(parse('tab=processing&q=%20SF-0001%20&page=3')).toEqual({
      tab: 'processing',
      q: 'SF-0001',
      page: 3,
    });
  });

  it.each([
    ['tab=refunded', { tab: 'all' }],
    ['page=0', { page: 1 }],
    ['page=abc', { page: 1 }],
    ['page=1001', { page: 1 }],
    ['q=%20%20', { q: undefined }],
  ])('bỏ giá trị sai: %s', (qs, expected) => {
    expect(parse(qs)).toMatchObject(expected);
  });

  it('từ khoá quá dài trên URL bị cắt còn 100 ký tự', () => {
    expect(parse(`q=${'a'.repeat(150)}`).q).toHaveLength(100);
  });

  it('round-trip, bỏ giá trị mặc định', () => {
    expect(toOrderSearchParams({ tab: 'shipping', q: 'tai', page: 2 }).toString()).toBe(
      'tab=shipping&q=tai&page=2',
    );
    expect(toOrderSearchParams({ tab: 'all', page: 1 }).toString()).toBe('');
  });
});

describe('tabCount', () => {
  it('Đang xử lý = PAID + PROCESSING; Tất cả = tổng', () => {
    expect(tabCount('processing', COUNTS)).toBe(5);
    expect(tabCount('all', COUNTS)).toBe(21);
    expect(tabCount('cancelled', COUNTS)).toBe(6);
  });

  it('chưa có số liệu → undefined (không hiện số)', () => {
    expect(tabCount('all', undefined)).toBeUndefined();
  });
});

describe('validateSearch', () => {
  it('trim; rỗng = bỏ lọc', () => {
    expect(validateSearch('  SF-0001 ')).toEqual({ q: 'SF-0001' });
    expect(validateSearch('   ')).toEqual({ q: undefined });
  });

  it('quá 100 ký tự → lỗi tiếng Việt', () => {
    expect(validateSearch('a'.repeat(101))).toEqual({ error: 'Từ khoá tối đa 100 ký tự.' });
    expect(validateSearch('a'.repeat(100)).error).toBeUndefined();
  });
});
