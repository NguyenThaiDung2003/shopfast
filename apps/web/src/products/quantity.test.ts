import { describe, expect, it } from 'vitest';
import { parseProductId } from './product-api';
import { clampQuantity, maxPurchasable, validateQuantity } from './quantity';

describe('validateQuantity', () => {
  it.each([
    ['1', 10, undefined],
    [' 3 ', 10, undefined],
    ['10', 10, undefined],
    ['', 10, 'Số lượng phải là số nguyên từ 1.'],
    ['1.5', 10, 'Số lượng phải là số nguyên từ 1.'],
    ['-1', 10, 'Số lượng phải là số nguyên từ 1.'],
    ['abc', 10, 'Số lượng phải là số nguyên từ 1.'],
    ['0', 10, 'Số lượng tối thiểu là 1.'],
    ['11', 10, 'Chỉ còn 10 sản phẩm.'],
    ['100', 500, 'Mỗi lần tối đa 99 sản phẩm.'],
  ])('"%s" (tồn %d) → %s', (text, stock, expected) => {
    expect(validateQuantity(text, stock)).toBe(expected);
  });
});

describe('maxPurchasable / clampQuantity', () => {
  it('không vượt tồn kho và giới hạn 99', () => {
    expect(maxPurchasable(3)).toBe(3);
    expect(maxPurchasable(500)).toBe(99);
    expect(maxPurchasable(0)).toBe(0);
  });

  it('kẹp trong [1, max]', () => {
    expect(clampQuantity(0, 5)).toBe(1);
    expect(clampQuantity(7, 5)).toBe(5);
    expect(clampQuantity(2.9, 5)).toBe(2);
  });
});

describe('parseProductId', () => {
  it.each([
    ['42', 42],
    ['2147483647', 2_147_483_647],
    ['0', null],
    ['2147483648', null],
    ['abc', null],
    ['12abc', null],
    ['-1', null],
    [undefined, null],
  ])('%s → %s', (raw, expected) => {
    expect(parseProductId(raw)).toBe(expected);
  });
});
