import { buildProductOrderBy, buildProductWhere, ProductSort } from './catalog.query';

describe('buildProductWhere', () => {
  it('không có bộ lọc → where rỗng (lấy tất cả)', () => {
    expect(buildProductWhere({})).toEqual({});
  });

  it('lọc theo danh mục', () => {
    expect(buildProductWhere({ categoryId: 3 })).toEqual({ categoryId: 3 });
  });

  it('lọc theo thương hiệu', () => {
    expect(buildProductWhere({ brandId: 7 })).toEqual({ brandId: 7 });
  });

  it('khoảng giá đủ hai đầu', () => {
    expect(buildProductWhere({ minPrice: 1_000_000, maxPrice: 5_000_000 })).toEqual({
      price: { gte: 1_000_000, lte: 5_000_000 },
    });
  });

  it('chỉ giá tối thiểu', () => {
    expect(buildProductWhere({ minPrice: 500_000 })).toEqual({ price: { gte: 500_000 } });
  });

  it('chỉ giá tối đa', () => {
    expect(buildProductWhere({ maxPrice: 200_000 })).toEqual({ price: { lte: 200_000 } });
  });

  it('minPrice = 0 vẫn là một điều kiện (không bị coi là falsy)', () => {
    expect(buildProductWhere({ minPrice: 0 })).toEqual({ price: { gte: 0 } });
  });

  it('kết hợp mọi bộ lọc', () => {
    expect(buildProductWhere({ categoryId: 1, brandId: 2, minPrice: 10, maxPrice: 20 })).toEqual({
      categoryId: 1,
      brandId: 2,
      price: { gte: 10, lte: 20 },
    });
  });

  it('bỏ qua trường undefined', () => {
    expect(buildProductWhere({ categoryId: undefined, brandId: 4 })).toEqual({ brandId: 4 });
  });
});

describe('buildProductOrderBy', () => {
  it.each([
    [ProductSort.NEWEST, { createdAt: 'desc' }],
    [ProductSort.PRICE_ASC, { price: 'asc' }],
    [ProductSort.PRICE_DESC, { price: 'desc' }],
    [ProductSort.NAME_ASC, { name: 'asc' }],
  ])('%s sắp theo khoá chính rồi id để phân trang ổn định', (sort, primary) => {
    expect(buildProductOrderBy(sort)).toEqual([primary, { id: 'asc' }]);
  });
});
