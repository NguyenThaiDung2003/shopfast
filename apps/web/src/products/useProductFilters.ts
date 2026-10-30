import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { parseFilters, toSearchParams, type ProductFilters } from './product-filters';

type FilterPatch = Partial<ProductFilters>;

/**
 * Bộ lọc nằm trên URL (chia sẻ link, Back/Forward, reload giữ nguyên).
 * Đổi bộ lọc/sắp xếp → về trang 1; chỉ đổi `page`/`view` thì giữ nguyên phần còn lại.
 */
export function useProductFilters() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);

  const update = useCallback(
    (patch: FilterPatch) => {
      const next: ProductFilters = { ...filters, ...patch };
      if (!('page' in patch) && !('view' in patch)) next.page = 1;
      setParams(toSearchParams(next));
    },
    [filters, setParams],
  );

  /** "Xoá bộ lọc": bỏ danh mục, thương hiệu, giá, từ khoá; giữ sắp xếp và kiểu hiển thị. */
  const clear = useCallback(() => {
    setParams(toSearchParams({ sort: filters.sort, view: filters.view, page: 1 }));
  }, [filters.sort, filters.view, setParams]);

  return { filters, update, clear };
}
