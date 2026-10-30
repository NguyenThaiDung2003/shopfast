import { describe, expect, it } from 'vitest';
import { discountPercent, formatSold } from './product-display';

describe('discountPercent', () => {
  it('làm tròn %; không có giá gốc hợp lệ → null', () => {
    expect(discountPercent(760_000, 1_000_000)).toBe(24);
    expect(discountPercent(1_000_000, 1_000_000)).toBeNull();
    expect(discountPercent(1_000_000, 900_000)).toBeNull();
    expect(discountPercent(1_000_000, null)).toBeNull();
    expect(discountPercent(1_000_000, undefined)).toBeNull();
  });
});

describe('formatSold', () => {
  it('rút gọn từ nghìn', () => {
    expect(formatSold(890)).toBe('Đã bán 890');
    expect(formatSold(1_400)).toBe('Đã bán 1,4k');
    expect(formatSold(5_000)).toBe('Đã bán 5k');
  });
});
