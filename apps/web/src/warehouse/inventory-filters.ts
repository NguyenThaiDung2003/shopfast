// Bộ lọc trang "Quản lý tồn kho": URL ⇄ filters; mức tồn; validate kiểm kê và nhập/xuất kho.

import type { BadgeTone } from '../components/ui';
import { formatNumber } from '../lib/format';
import type { ProductPatch } from './warehouse-api';

export type StockLevel = 'out' | 'low' | 'ok';
export type InventorySort = 'stock_asc' | 'stock_desc' | 'sku' | 'updated';

export const STOCK_LEVELS: readonly StockLevel[] = ['out', 'low', 'ok'];
export const INVENTORY_SORTS: ReadonlyArray<{ value: InventorySort; label: string }> = [
  { value: 'stock_asc', label: 'Tồn kho tăng dần' },
  { value: 'stock_desc', label: 'Tồn kho giảm dần' },
  { value: 'sku', label: 'Mã SKU (A → Z)' },
  { value: 'updated', label: 'Cập nhật gần nhất' },
];

/** API: InventoryQuery (limit ≤ 100), UpdateProductDto (stock ≤ 1.000.000, price ≤ 2 tỷ). */
export const INVENTORY_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_INVENTORY_PAGE_SIZE = 25;
export const MAX_PAGE = 1000;
export const MAX_SEARCH_LENGTH = 100;
export const MAX_STOCK = 1_000_000;
export const MAX_PRICE = 2_000_000_000;
export const MAX_IMAGE_URL_LENGTH = 500;

/** Cùng luật với IMAGE_URL_PATTERN của API: `/...` trong site hoặc `https://...`. */
const IMAGE_URL = /^(?:\/(?![/\\])|https:\/\/)[^\s\\]+$/;

export interface InventoryFilters {
  q?: string;
  categoryId?: number;
  stockLevel?: StockLevel;
  sort: InventorySort;
  page: number;
  limit: number;
}

const SORTS = new Set<string>(INVENTORY_SORTS.map((s) => s.value));
const toInt = (raw: string | null) => (raw && /^\d+$/.test(raw) ? Number(raw) : undefined);

export function parseInventoryFilters(params: URLSearchParams): InventoryFilters {
  const q = params.get('q')?.trim().slice(0, MAX_SEARCH_LENGTH);
  const categoryId = toInt(params.get('categoryId'));
  const level = params.get('stockLevel');
  const sort = params.get('sort');
  const page = toInt(params.get('page'));
  const limit = toInt(params.get('limit'));
  return {
    q: q || undefined,
    categoryId: categoryId && categoryId >= 1 ? categoryId : undefined,
    stockLevel: STOCK_LEVELS.includes(level as StockLevel) ? (level as StockLevel) : undefined,
    sort: sort && SORTS.has(sort) ? (sort as InventorySort) : 'stock_asc',
    page: page && page >= 1 && page <= MAX_PAGE ? page : 1,
    limit:
      limit && (INVENTORY_PAGE_SIZES as readonly number[]).includes(limit)
        ? limit
        : DEFAULT_INVENTORY_PAGE_SIZE,
  };
}

export function toInventorySearchParams(filters: InventoryFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.categoryId) params.set('categoryId', String(filters.categoryId));
  if (filters.stockLevel) params.set('stockLevel', filters.stockLevel);
  if (filters.sort !== 'stock_asc') params.set('sort', filters.sort);
  if (filters.page > 1) params.set('page', String(filters.page));
  if (filters.limit !== DEFAULT_INVENTORY_PAGE_SIZE) params.set('limit', String(filters.limit));
  return params;
}

export function validateInventorySearch(text: string): { q?: string; error?: string } {
  const q = text.trim();
  if (q.length > MAX_SEARCH_LENGTH) return { error: `Từ khoá tối đa ${MAX_SEARCH_LENGTH} ký tự.` };
  return { q: q || undefined };
}

export interface StockLevelView {
  level: StockLevel;
  label: string;
  /** Nhãn dưới mã SKU như thiết kế. */
  tag: string;
  tone: BadgeTone;
}

/** Mức tồn theo ngưỡng API trả (`summary.lowStockThreshold`) – web không tự đặt ngưỡng. */
export function stockLevelOf(stock: number, threshold: number): StockLevelView {
  if (stock <= 0)
    return { level: 'out', label: 'Hết hàng', tag: 'Ưu tiên nhập gấp', tone: 'danger' };
  if (stock < threshold) {
    return {
      level: 'low',
      label: `Sắp hết (< ${formatNumber(threshold)} chiếc)`,
      tag: 'Sắp hết hàng',
      tone: 'warning',
    };
  }
  return { level: 'ok', label: 'Còn hàng', tag: 'Sẵn hàng', tone: 'success' };
}

export const STOCK_LEVEL_LABEL: Record<StockLevel, (threshold: number) => string> = {
  out: () => 'Hết hàng (0)',
  low: (t) => `Sắp hết (< ${formatNumber(t)})`,
  ok: (t) => `Đủ hàng (≥ ${formatNumber(t)})`,
};

const INT = /^\d+$/;

/** Kiểm kê: số tồn thực tế là số nguyên 0 – 1.000.000. */
export function validateStockCount(text: string): { value?: number; error?: string } {
  const raw = text.trim();
  if (!INT.test(raw)) return { error: 'Nhập số lượng là số nguyên ≥ 0.' };
  const value = Number(raw);
  if (value > MAX_STOCK) return { error: `Tồn kho tối đa ${formatNumber(MAX_STOCK)}.` };
  return { value };
}

export interface AdjustmentInput {
  direction: 'in' | 'out';
  quantity: string;
  /** Rỗng = không đổi giá. */
  price: string;
  /** Rỗng = bỏ giảm giá. */
  compareAtPrice: string;
  /** Rỗng = xoá ảnh. */
  imageUrl: string;
  current: {
    stock: number;
    price: number;
    compareAtPrice: number | null;
    imageUrl: string | null;
  };
  canEditPrice: boolean;
}

type AdjustmentPatch = Pick<ProductPatch, 'stockDelta' | 'price' | 'compareAtPrice' | 'imageUrl'>;

export interface AdjustmentResult {
  patch?: AdjustmentPatch;
  errors: {
    quantity?: string;
    price?: string;
    compareAtPrice?: string;
    imageUrl?: string;
    form?: string;
  };
}

/** Giá gốc phải lớn hơn giá bán sau khi lưu; giá bán đổi thì kiểm lại cả giá gốc đang có. */
function applyCompareAtPrice(
  input: AdjustmentInput,
  patch: AdjustmentPatch,
  errors: AdjustmentResult['errors'],
): void {
  const text = input.compareAtPrice.trim();
  if (text && !INT.test(text)) {
    errors.compareAtPrice = 'Giá gốc phải là số nguyên (đồng).';
    return;
  }
  const next = text ? Number(text) : null;
  if (next !== null && next > MAX_PRICE) {
    errors.compareAtPrice = 'Giá tối đa 2.000.000.000 ₫.';
    return;
  }
  const changed = next !== input.current.compareAtPrice;
  if ((changed || patch.price !== undefined) && next !== null) {
    if (next <= (patch.price ?? input.current.price)) {
      errors.compareAtPrice = 'Giá gốc phải lớn hơn giá bán; để trống nếu không giảm giá.';
      return;
    }
  }
  if (changed) patch.compareAtPrice = next;
}

function applyImageUrl(
  input: AdjustmentInput,
  patch: AdjustmentPatch,
  errors: AdjustmentResult['errors'],
): void {
  const text = input.imageUrl.trim();
  if (text.length > MAX_IMAGE_URL_LENGTH) {
    errors.imageUrl = `Đường dẫn ảnh tối đa ${MAX_IMAGE_URL_LENGTH} ký tự.`;
  } else if (text && !IMAGE_URL.test(text)) {
    errors.imageUrl = 'Đường dẫn ảnh phải bắt đầu bằng / hoặc https://.';
  } else if ((text || null) !== input.current.imageUrl) {
    patch.imageUrl = text || null;
  }
}

/** Nhập/xuất kho (stockDelta) và sửa giá, giá gốc, ảnh (chỉ ADMIN) – khớp UpdateProductDto. */
export function validateAdjustment(input: AdjustmentInput): AdjustmentResult {
  const errors: AdjustmentResult['errors'] = {};
  const patch: AdjustmentPatch = {};

  const qty = input.quantity.trim();
  if (qty) {
    if (!INT.test(qty) || Number(qty) === 0) {
      errors.quantity = 'Số lượng phải là số nguyên lớn hơn 0.';
    } else if (Number(qty) > MAX_STOCK) {
      errors.quantity = `Số lượng tối đa ${formatNumber(MAX_STOCK)}.`;
    } else if (input.direction === 'out' && Number(qty) > input.current.stock) {
      errors.quantity = `Không thể xuất quá số đang tồn (${formatNumber(input.current.stock)}).`;
    } else if (input.direction === 'in' && input.current.stock + Number(qty) > MAX_STOCK) {
      errors.quantity = `Tồn sau khi nhập vượt ${formatNumber(MAX_STOCK)}.`;
    } else {
      patch.stockDelta = input.direction === 'in' ? Number(qty) : -Number(qty);
    }
  }

  const price = input.price.trim();
  if (input.canEditPrice && price) {
    if (!INT.test(price)) errors.price = 'Giá phải là số nguyên ≥ 0 (đồng).';
    else if (Number(price) > MAX_PRICE) errors.price = 'Giá tối đa 2.000.000.000 ₫.';
    else if (Number(price) !== input.current.price) patch.price = Number(price);
  }

  if (input.canEditPrice) {
    applyCompareAtPrice(input, patch, errors);
    applyImageUrl(input, patch, errors);
  }

  if (Object.keys(errors).length === 0 && Object.keys(patch).length === 0) {
    errors.form = input.canEditPrice
      ? 'Nhập số lượng nhập/xuất hoặc thông tin cần đổi.'
      : 'Nhập số lượng cần nhập hoặc xuất kho.';
  }
  return Object.keys(errors).length > 0 ? { errors } : { patch, errors };
}
