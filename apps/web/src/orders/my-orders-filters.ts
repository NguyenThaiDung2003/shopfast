// Bộ lọc trang "Đơn hàng của tôi": URL `?tab=&q=&page=` ⇄ filters; tab → nhóm trạng thái.

import type { OrderStatus } from './order-status';

export type OrderTab = 'all' | 'pending' | 'processing' | 'shipping' | 'delivered' | 'cancelled';

export const ORDER_TABS: ReadonlyArray<{
  value: OrderTab;
  label: string;
  /** Trạng thái gửi API; rỗng = tất cả. */
  statuses: readonly OrderStatus[];
}> = [
  { value: 'all', label: 'Tất cả', statuses: [] },
  { value: 'pending', label: 'Chờ thanh toán', statuses: ['PENDING_PAYMENT'] },
  { value: 'processing', label: 'Đang xử lý', statuses: ['PAID', 'PROCESSING'] },
  { value: 'shipping', label: 'Đang giao', statuses: ['SHIPPING'] },
  { value: 'delivered', label: 'Đã giao', statuses: ['DELIVERED'] },
  { value: 'cancelled', label: 'Đã huỷ', statuses: ['CANCELLED'] },
];

/** API: ListOrdersQuery (limit ≤ 50, page ≤ 1000, q ≤ 100 ký tự). */
export const ORDER_PAGE_SIZE = 10;
export const MAX_ORDER_PAGE = 1000;
export const MAX_SEARCH_LENGTH = 100;

export type StatusCounts = Record<OrderStatus, number>;

export interface OrderFilters {
  tab: OrderTab;
  q?: string;
  page: number;
}

const TABS = new Set<string>(ORDER_TABS.map((t) => t.value));

export function tabStatuses(tab: OrderTab): readonly OrderStatus[] {
  return ORDER_TABS.find((t) => t.value === tab)?.statuses ?? [];
}

export function parseOrderFilters(params: URLSearchParams): OrderFilters {
  const tab = params.get('tab');
  const page = params.get('page');
  const pageNumber = page && /^\d+$/.test(page) ? Number(page) : 1;
  const q = params.get('q')?.trim().slice(0, MAX_SEARCH_LENGTH);
  return {
    tab: tab && TABS.has(tab) ? (tab as OrderTab) : 'all',
    q: q || undefined,
    page: pageNumber >= 1 && pageNumber <= MAX_ORDER_PAGE ? pageNumber : 1,
  };
}

export function toOrderSearchParams(filters: OrderFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.tab !== 'all') params.set('tab', filters.tab);
  if (filters.q) params.set('q', filters.q);
  if (filters.page > 1) params.set('page', String(filters.page));
  return params;
}

/** Số đơn của tab (tab "Đang xử lý" = PAID + PROCESSING, "Tất cả" = tổng). */
export function tabCount(tab: OrderTab, counts: StatusCounts | undefined): number | undefined {
  if (!counts) return undefined;
  const statuses = tabStatuses(tab);
  const keys = statuses.length > 0 ? statuses : (Object.keys(counts) as OrderStatus[]);
  return keys.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
}

/** Ô tìm kiếm: rỗng → bỏ lọc; quá dài → lỗi tiếng Việt. */
export function validateSearch(text: string): { q?: string; error?: string } {
  const q = text.trim();
  if (q.length > MAX_SEARCH_LENGTH) {
    return { error: `Từ khoá tối đa ${MAX_SEARCH_LENGTH} ký tự.` };
  }
  return { q: q || undefined };
}
