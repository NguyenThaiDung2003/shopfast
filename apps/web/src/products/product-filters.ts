// Bộ lọc trang danh sách sản phẩm: URL query ⇄ filters, validate form giá.
// Khớp ListProductsQuery của API (apps/api/src/modules/catalog/dto/list-products.query.ts).

import { formatNumber, formatPrice } from '../lib/format';

export type ProductSort = 'newest' | 'price_asc' | 'price_desc' | 'name_asc';
export type ProductView = 'grid' | 'list';

export const SORT_OPTIONS: ReadonlyArray<{ value: ProductSort; label: string }> = [
  { value: 'newest', label: 'Mới nhất' },
  { value: 'price_asc', label: 'Giá thấp đến cao' },
  { value: 'price_desc', label: 'Giá cao đến thấp' },
  { value: 'name_asc', label: 'Tên A → Z' },
];

export const DEFAULT_SORT: ProductSort = 'newest';
/** 12 chia hết cho lưới 2/3/4 cột. */
export const PAGE_SIZE = 12;
/** API chặn OFFSET quá sâu (MAX_PAGE). */
export const MAX_PAGE = 1000;
/** Chặn số vô lý trên form/URL (giá lưu Int theo đồng). */
export const MAX_PRICE = 1_000_000_000;
/** Phạm vi thanh trượt giá (API chưa trả giá min/max của catalog). */
export const SLIDER_MAX = 50_000_000;
export const SLIDER_STEP = 100_000;

export const PRICE_PRESETS: ReadonlyArray<{ label: string; min?: number; max?: number }> = [
  { label: '< 1 triệu', max: 1_000_000 },
  { label: '1tr - 5tr', min: 1_000_000, max: 5_000_000 },
  { label: '5tr - 15tr', min: 5_000_000, max: 15_000_000 },
  { label: '> 15 triệu', min: 15_000_000 },
];

export interface ProductFilters {
  categoryId?: number;
  brandId?: number;
  minPrice?: number;
  maxPrice?: number;
  sort: ProductSort;
  page: number;
  view: ProductView;
  /** Từ ô tìm kiếm header – API chưa hỗ trợ, chỉ để hiện thông báo. */
  q?: string;
}

const SORTS = new Set<string>(SORT_OPTIONS.map((o) => o.value));

function intParam(value: string | null, min: number, max: number): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : undefined;
}

/** Đọc URL; giá trị sai bị bỏ qua (không để API trả 400 vì URL gõ tay/link cũ). */
export function parseFilters(params: URLSearchParams): ProductFilters {
  let minPrice = intParam(params.get('minPrice'), 0, MAX_PRICE);
  let maxPrice = intParam(params.get('maxPrice'), 0, MAX_PRICE);
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    minPrice = undefined;
    maxPrice = undefined;
  }
  const sort = params.get('sort');
  const q = params.get('q')?.trim();
  return {
    categoryId: intParam(params.get('categoryId'), 1, Number.MAX_SAFE_INTEGER),
    brandId: intParam(params.get('brandId'), 1, Number.MAX_SAFE_INTEGER),
    minPrice,
    maxPrice,
    sort: sort && SORTS.has(sort) ? (sort as ProductSort) : DEFAULT_SORT,
    page: intParam(params.get('page'), 1, MAX_PAGE) ?? 1,
    view: params.get('view') === 'list' ? 'list' : 'grid',
    q: q || undefined,
  };
}

/** Ghi URL: thứ tự key cố định, bỏ giá trị mặc định cho URL ngắn gọn. */
export function toSearchParams(filters: ProductFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.categoryId !== undefined) params.set('categoryId', String(filters.categoryId));
  if (filters.brandId !== undefined) params.set('brandId', String(filters.brandId));
  if (filters.minPrice !== undefined) params.set('minPrice', String(filters.minPrice));
  if (filters.maxPrice !== undefined) params.set('maxPrice', String(filters.maxPrice));
  if (filters.sort !== DEFAULT_SORT) params.set('sort', filters.sort);
  if (filters.page > 1) params.set('page', String(filters.page));
  if (filters.view !== 'grid') params.set('view', filters.view);
  return params;
}

/** Số bộ lọc đang áp dụng (danh mục, thương hiệu, khoảng giá). */
export function activeFilterCount(filters: ProductFilters): number {
  return (
    Number(filters.categoryId !== undefined) +
    Number(filters.brandId !== undefined) +
    Number(filters.minPrice !== undefined || filters.maxPrice !== undefined)
  );
}

// ---- Form giá ------------------------------------------------------------------------------

/** "2.000.000" / "2 000 000 ₫" → 2000000; rỗng → undefined; sai định dạng → NaN. */
export function parseMoneyInput(text: string): number | undefined {
  const cleaned = text.replace(/[\s.₫đ]/gi, '');
  if (cleaned === '') return undefined;
  return /^\d+$/.test(cleaned) ? Number(cleaned) : Number.NaN;
}

/** Hiển thị trong ô nhập: 2000000 → "2.000.000". */
export function formatMoneyInput(value: number | undefined): string {
  return value === undefined ? '' : formatNumber(value);
}

export interface PriceDraftResult {
  minPrice?: number;
  maxPrice?: number;
  errors: { min?: string; max?: string };
}

function checkPrice(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (Number.isNaN(value)) return 'Giá phải là số nguyên không âm.';
  if (value > MAX_PRICE) return `Giá không được vượt quá ${formatPrice(MAX_PRICE)}.`;
  return undefined;
}

export function validatePriceDraft(minText: string, maxText: string): PriceDraftResult {
  const minPrice = parseMoneyInput(minText);
  const maxPrice = parseMoneyInput(maxText);
  const errors: PriceDraftResult['errors'] = {
    min: checkPrice(minPrice),
    max: checkPrice(maxPrice),
  };
  if (
    !errors.min &&
    !errors.max &&
    minPrice !== undefined &&
    maxPrice !== undefined &&
    minPrice > maxPrice
  ) {
    errors.max = 'Giá tối đa phải lớn hơn hoặc bằng giá tối thiểu.';
  }
  return { minPrice, maxPrice, errors };
}

export function hasErrors(result: PriceDraftResult): boolean {
  return Boolean(result.errors.min || result.errors.max);
}
