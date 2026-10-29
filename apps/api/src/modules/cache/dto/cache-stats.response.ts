export class CacheNamespaceStatsDto {
  /** Nhóm cache: `product` (chi tiết), `product_list` (danh sách), hoặc `total`. */
  name!: string;
  /** Số lần đọc trúng cache. */
  hits!: number;
  /** Số lần trượt cache (phải đọc DB). */
  misses!: number;
  /** hits / (hits + misses), từ 0 đến 1; 0 khi chưa có lượt đọc nào. */
  hitRate!: number;
}

export class CacheStatsDto {
  /** Cache có đang bật (CACHE_ENABLED) hay không. */
  enabled!: boolean;
  namespaces!: CacheNamespaceStatsDto[];
  /** Cộng dồn mọi nhóm. */
  total!: CacheNamespaceStatsDto;
}
