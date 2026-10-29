import { Prisma } from '@prisma/client';

export enum ProductSort {
  NEWEST = 'newest',
  PRICE_ASC = 'price_asc',
  PRICE_DESC = 'price_desc',
  NAME_ASC = 'name_asc',
}

export interface ProductFilter {
  categoryId?: number;
  brandId?: number;
  minPrice?: number;
  maxPrice?: number;
}

/** Chỉ thêm điều kiện cho bộ lọc có giá trị; không lọc gì → where rỗng. */
export function buildProductWhere(filter: ProductFilter): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {};
  if (filter.categoryId !== undefined) where.categoryId = filter.categoryId;
  if (filter.brandId !== undefined) where.brandId = filter.brandId;

  const price: Prisma.IntFilter = {};
  if (filter.minPrice !== undefined) price.gte = filter.minPrice;
  if (filter.maxPrice !== undefined) price.lte = filter.maxPrice;
  if (Object.keys(price).length > 0) where.price = price;

  return where;
}

// Mọi kiểu sắp xếp đều kết thúc bằng id để thứ tự xác định khi trùng giá/tên/thời điểm,
// nếu không phân trang OFFSET có thể lặp hoặc bỏ sót sản phẩm giữa các trang.
const ORDER_BY: Record<ProductSort, Prisma.ProductOrderByWithRelationInput[]> = {
  [ProductSort.NEWEST]: [{ createdAt: 'desc' }, { id: 'asc' }],
  [ProductSort.PRICE_ASC]: [{ price: 'asc' }, { id: 'asc' }],
  [ProductSort.PRICE_DESC]: [{ price: 'desc' }, { id: 'asc' }],
  [ProductSort.NAME_ASC]: [{ name: 'asc' }, { id: 'asc' }],
};

export function buildProductOrderBy(sort: ProductSort): Prisma.ProductOrderByWithRelationInput[] {
  return ORDER_BY[sort];
}
