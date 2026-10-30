import { describe, expect, it } from 'vitest';
import { formatCompactPrice } from '../lib/format';
import {
  activeFilterCount,
  parseFilters,
  parseMoneyInput,
  toSearchParams,
  validatePriceDraft,
} from './product-filters';

const parse = (qs: string) => parseFilters(new URLSearchParams(qs));

describe('parseFilters', () => {
  it('mặc định: trang 1, mới nhất, dạng lưới', () => {
    expect(parse('')).toEqual({
      categoryId: undefined,
      brandId: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      sort: 'newest',
      page: 1,
      view: 'grid',
      q: undefined,
    });
  });

  it('đọc đủ tham số hợp lệ', () => {
    expect(
      parse(
        'categoryId=3&brandId=7&minPrice=500000&maxPrice=2000000&sort=price_asc&page=4&view=list&q=%20tai%20nghe%20',
      ),
    ).toEqual({
      categoryId: 3,
      brandId: 7,
      minPrice: 500_000,
      maxPrice: 2_000_000,
      sort: 'price_asc',
      page: 4,
      view: 'list',
      q: 'tai nghe',
    });
  });

  it.each([
    ['categoryId=abc', { categoryId: undefined }],
    ['categoryId=0', { categoryId: undefined }],
    ['brandId=-2', { brandId: undefined }],
    ['brandId=1.5', { brandId: undefined }],
    ['minPrice=-1', { minPrice: undefined }],
    ['maxPrice=99999999999', { maxPrice: undefined }],
    ['sort=best_seller', { sort: 'newest' }],
    ['page=0', { page: 1 }],
    ['page=1001', { page: 1 }],
    ['view=table', { view: 'grid' }],
  ])('bỏ giá trị sai trên URL: %s', (qs, expected) => {
    expect(parse(qs)).toMatchObject(expected);
  });

  it('khoảng giá ngược trên URL → bỏ cả hai (tránh API trả 400)', () => {
    expect(parse('minPrice=5000000&maxPrice=1000000')).toMatchObject({
      minPrice: undefined,
      maxPrice: undefined,
    });
  });
});

describe('toSearchParams', () => {
  it('bỏ giá trị mặc định, thứ tự key cố định', () => {
    const params = toSearchParams({
      sort: 'newest',
      page: 1,
      view: 'grid',
      maxPrice: 2_000_000,
      categoryId: 1,
    });
    expect(params.toString()).toBe('categoryId=1&maxPrice=2000000');
  });

  it('round-trip với parseFilters', () => {
    const qs = 'categoryId=1&brandId=2&minPrice=0&maxPrice=10&sort=name_asc&page=3&view=list';
    expect(toSearchParams(parse(qs)).toString()).toBe(qs);
  });
});

describe('activeFilterCount', () => {
  it('khoảng giá tính là một bộ lọc', () => {
    expect(activeFilterCount(parse('categoryId=1&minPrice=1&maxPrice=2&sort=price_asc'))).toBe(2);
  });
});

describe('form giá', () => {
  it('parseMoneyInput chấp nhận dấu chấm, khoảng trắng, ký hiệu ₫', () => {
    expect(parseMoneyInput('2.000.000')).toBe(2_000_000);
    expect(parseMoneyInput(' 1 500 000 ₫ ')).toBe(1_500_000);
    expect(parseMoneyInput('')).toBeUndefined();
    expect(parseMoneyInput('1,5tr')).toBeNaN();
  });

  it('hợp lệ → trả số, không lỗi; ô trống = không giới hạn', () => {
    expect(validatePriceDraft('500.000', '')).toEqual({
      minPrice: 500_000,
      maxPrice: undefined,
      errors: { min: undefined, max: undefined },
    });
  });

  it('không phải số → lỗi tiếng Việt ở đúng ô', () => {
    expect(validatePriceDraft('abc', '100').errors).toEqual({
      min: 'Giá phải là số nguyên không âm.',
      max: undefined,
    });
  });

  it('vượt trần', () => {
    expect(validatePriceDraft('', '2.000.000.000').errors.max).toBe(
      'Giá không được vượt quá 1.000.000.000\u00A0₫.',
    );
  });

  it('min > max → lỗi ở ô tối đa', () => {
    expect(validatePriceDraft('5.000.000', '1.000.000').errors.max).toBe(
      'Giá tối đa phải lớn hơn hoặc bằng giá tối thiểu.',
    );
  });
});

describe('formatCompactPrice', () => {
  it.each([
    [500_000, '500k'],
    [2_000_000, '2tr'],
    [1_500_000, '1,5tr'],
    [1_200_000_000, '1,2 tỷ'],
    [800, '800\u00A0₫'],
  ])('%d → %s', (value, expected) => {
    expect(formatCompactPrice(value)).toBe(expected);
  });
});
