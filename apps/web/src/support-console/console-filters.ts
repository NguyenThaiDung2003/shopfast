// Bộ lọc hàng đợi "Bàn làm việc CSKH": URL `?status=&category=&q=&page=&ticket=` ⇄ filters;
// validate câu hỏi Copilot và ghi chú xác nhận đề xuất.

import { formatNumber } from '../lib/format';
import { isUuid } from '../lib/uuid';
import type { TicketStatusCounts } from '../support/my-tickets-filters';
import {
  TICKET_CATEGORY_META,
  type TicketCategory,
  type TicketStatus,
} from '../support/ticket-meta';

export type QueueTab = 'open' | 'answered' | 'closed' | 'all';

export const QUEUE_TABS: ReadonlyArray<{
  value: QueueTab;
  label: string;
  /** Trạng thái gửi API; undefined = tất cả. */
  status?: TicketStatus;
}> = [
  { value: 'open', label: 'Chờ xử lý', status: 'OPEN' },
  { value: 'answered', label: 'Đã trả lời', status: 'ANSWERED' },
  { value: 'closed', label: 'Đã đóng', status: 'CLOSED' },
  { value: 'all', label: 'Tất cả' },
];

/** Tab mặc định: ticket đang chờ nhân viên. */
export const DEFAULT_QUEUE_TAB: QueueTab = 'open';

/** API: ListTicketsQuery (q ≤ 100), AskAssistantDto (1–2000), DecidePendingActionDto (≤ 500). */
export const QUEUE_PAGE_SIZE = 20;
export const MAX_QUEUE_PAGE = 1000;
export const MAX_QUEUE_SEARCH_LENGTH = 100;
export const MAX_QUESTION_LENGTH = 2000;
export const MAX_NOTE_LENGTH = 500;

export interface QueueFilters {
  tab: QueueTab;
  category?: TicketCategory;
  q?: string;
  page: number;
  ticket?: string;
}

const TABS = new Set<string>(QUEUE_TABS.map((t) => t.value));

export function queueTabStatus(tab: QueueTab): TicketStatus | undefined {
  return QUEUE_TABS.find((t) => t.value === tab)?.status;
}

export function parseQueueFilters(params: URLSearchParams): QueueFilters {
  const tab = params.get('status');
  const category = params.get('category');
  const page = params.get('page');
  const pageNumber = page && /^\d+$/.test(page) ? Number(page) : 1;
  const q = params.get('q')?.trim().slice(0, MAX_QUEUE_SEARCH_LENGTH);
  const ticket = params.get('ticket');
  return {
    tab: tab && TABS.has(tab) ? (tab as QueueTab) : DEFAULT_QUEUE_TAB,
    category:
      category && Object.hasOwn(TICKET_CATEGORY_META, category)
        ? (category as TicketCategory)
        : undefined,
    q: q || undefined,
    page: pageNumber >= 1 && pageNumber <= MAX_QUEUE_PAGE ? pageNumber : 1,
    ticket: isUuid(ticket) ? ticket : undefined,
  };
}

export function toQueueSearchParams(filters: QueueFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.tab !== DEFAULT_QUEUE_TAB) params.set('status', filters.tab);
  if (filters.category) params.set('category', filters.category);
  if (filters.q) params.set('q', filters.q);
  if (filters.page > 1) params.set('page', String(filters.page));
  if (filters.ticket) params.set('ticket', filters.ticket);
  return params;
}

export function queueTabCount(
  tab: QueueTab,
  counts: TicketStatusCounts | undefined,
): number | undefined {
  if (!counts) return undefined;
  const status = queueTabStatus(tab);
  return status ? counts[status] : counts.OPEN + counts.ANSWERED + counts.CLOSED;
}

export function validateQueueSearch(text: string): { q?: string; error?: string } {
  const q = text.trim();
  if (q.length > MAX_QUEUE_SEARCH_LENGTH) {
    return { error: `Từ khoá tối đa ${MAX_QUEUE_SEARCH_LENGTH} ký tự.` };
  }
  return { q: q || undefined };
}

export function validateQuestion(text: string): string | undefined {
  const question = text.trim();
  if (!question) return 'Vui lòng nhập câu hỏi cho Copilot.';
  if (question.length > MAX_QUESTION_LENGTH)
    return `Câu hỏi tối đa ${formatNumber(MAX_QUESTION_LENGTH)} ký tự.`;
  return undefined;
}

export function validateDecisionNote(text: string): string | undefined {
  if (text.trim().length > MAX_NOTE_LENGTH) return `Ghi chú tối đa ${MAX_NOTE_LENGTH} ký tự.`;
  return undefined;
}
