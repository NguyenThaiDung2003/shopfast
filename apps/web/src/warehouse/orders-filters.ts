// Bộ lọc trang "Xử lý đơn kho": URL `?status=&q=&page=&limit=` ⇄ filters; validate ghi chú
// chuyển trạng thái. Luật chuyển trạng thái KHÔNG ở đây – API trả `nextStatuses` (ADR-0006).

import { ORDER_STATUS_META, type OrderStatus } from '../orders/order-status';

export type OrderTab = 'all' | OrderStatus;

export const ORDER_TABS: ReadonlyArray<{ value: OrderTab; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  ...(Object.keys(ORDER_STATUS_META) as OrderStatus[]).map((status) => ({
    value: status,
    label: ORDER_STATUS_META[status].label,
  })),
];

/** API: ListOrdersQuery (limit ≤ 50, page ≤ 1000, q ≤ 100), UpdateOrderStatusDto (note ≤ 500). */
export const PAGE_SIZES = [10, 25, 50] as const;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE = 1000;
export const MAX_SEARCH_LENGTH = 100;
export const MAX_NOTE_LENGTH = 500;

export interface WarehouseOrderFilters {
  tab: OrderTab;
  q?: string;
  page: number;
  limit: number;
}

const TABS = new Set<string>(ORDER_TABS.map((t) => t.value));

const toInt = (raw: string | null) => (raw && /^\d+$/.test(raw) ? Number(raw) : undefined);

export function parseOrderFilters(params: URLSearchParams): WarehouseOrderFilters {
  const tab = params.get('status');
  const page = toInt(params.get('page'));
  const limit = toInt(params.get('limit'));
  const q = params.get('q')?.trim().slice(0, MAX_SEARCH_LENGTH);
  return {
    tab: tab && TABS.has(tab) ? (tab as OrderTab) : 'all',
    q: q || undefined,
    page: page && page >= 1 && page <= MAX_PAGE ? page : 1,
    limit: limit && (PAGE_SIZES as readonly number[]).includes(limit) ? limit : DEFAULT_PAGE_SIZE,
  };
}

export function toOrderSearchParams(filters: WarehouseOrderFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.tab !== 'all') params.set('status', filters.tab);
  if (filters.q) params.set('q', filters.q);
  if (filters.page > 1) params.set('page', String(filters.page));
  if (filters.limit !== DEFAULT_PAGE_SIZE) params.set('limit', String(filters.limit));
  return params;
}

export function validateOrderSearch(text: string): { q?: string; error?: string } {
  const q = text.trim();
  if (q.length > MAX_SEARCH_LENGTH) return { error: `Từ khoá tối đa ${MAX_SEARCH_LENGTH} ký tự.` };
  return { q: q || undefined };
}

/** Ghi chú chuyển trạng thái: tối đa 500 ký tự; huỷ đơn thì bắt buộc ghi lý do. */
export function validateStatusNote(to: OrderStatus, note: string): string | undefined {
  const text = note.trim();
  if (to === 'CANCELLED' && !text) return 'Vui lòng nhập lý do huỷ đơn.';
  if (text.length > MAX_NOTE_LENGTH) return `Ghi chú tối đa ${MAX_NOTE_LENGTH} ký tự.`;
  return undefined;
}
