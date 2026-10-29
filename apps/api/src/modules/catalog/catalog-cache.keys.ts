import { hashKey } from '../cache/cache.service';
import { ListProductsQuery } from './dto/list-products.query';

/** Version chung của mọi trang danh sách; INCR → mọi key danh sách cũ thành mồ côi. */
export const CATALOG_VERSION_KEY = 'cache:products:ver';

export const productVersionKey = (id: number) => `cache:product:${id}:ver`;
export const productKeyPrefix = (id: number) => `cache:product:${id}:v`;
export const productKey = (id: number, version: string) => `${productKeyPrefix(id)}${version}`;
export const listKey = (version: string, hash: string) => `cache:products:v${version}:${hash}`;

/**
 * Bộ lọc đã chuẩn hoá: chỉ các trường ảnh hưởng kết quả, default đã áp (DTO), bỏ undefined,
 * thứ tự cố định → `?brandId=2&categoryId=1` và `?categoryId=1&brandId=2` cùng một key.
 */
export function listQueryHash(query: ListProductsQuery): string {
  const { categoryId, brandId, minPrice, maxPrice, sort, page, limit } = query;
  return hashKey({ categoryId, brandId, minPrice, maxPrice, sort, page, limit });
}
