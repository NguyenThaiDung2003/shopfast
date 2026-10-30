// Bộ lọc trang "Hỗ trợ khách hàng": URL `?tab=&q=&page=&ticket=` ⇄ filters; validate form ticket.

import { formatNumber } from '../lib/format';
import { isUuid } from '../lib/uuid';
import type { TicketStatus } from './ticket-meta';

export type TicketTab = 'all' | 'open' | 'closed';

export const TICKET_TABS: ReadonlyArray<{
  value: TicketTab;
  label: string;
  /** Trạng thái gửi API; rỗng = tất cả. */
  statuses: readonly TicketStatus[];
}> = [
  { value: 'all', label: 'Tất cả', statuses: [] },
  { value: 'open', label: 'Đang xử lý', statuses: ['OPEN', 'ANSWERED'] },
  { value: 'closed', label: 'Đã đóng', statuses: ['CLOSED'] },
];

/** API: ListMyTicketsQuery (q ≤ 100), CreateTicketDto (subject ≤ 200, message ≤ 5000). */
export const TICKET_PAGE_SIZE = 10;
export const MAX_TICKET_PAGE = 1000;
export const MAX_TICKET_SEARCH_LENGTH = 100;
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_MESSAGE_LENGTH = 5000;

export type TicketStatusCounts = Record<TicketStatus, number>;

export interface TicketFilters {
  tab: TicketTab;
  q?: string;
  page: number;
  /** Ticket đang mở ở khung hội thoại. */
  ticket?: string;
}

const TABS = new Set<string>(TICKET_TABS.map((t) => t.value));

export function ticketTabStatuses(tab: TicketTab): readonly TicketStatus[] {
  return TICKET_TABS.find((t) => t.value === tab)?.statuses ?? [];
}

export function parseTicketFilters(params: URLSearchParams): TicketFilters {
  const tab = params.get('tab');
  const page = params.get('page');
  const pageNumber = page && /^\d+$/.test(page) ? Number(page) : 1;
  const q = params.get('q')?.trim().slice(0, MAX_TICKET_SEARCH_LENGTH);
  const ticket = params.get('ticket');
  return {
    tab: tab && TABS.has(tab) ? (tab as TicketTab) : 'all',
    q: q || undefined,
    page: pageNumber >= 1 && pageNumber <= MAX_TICKET_PAGE ? pageNumber : 1,
    ticket: isUuid(ticket) ? ticket : undefined,
  };
}

export function toTicketSearchParams(filters: TicketFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.tab !== 'all') params.set('tab', filters.tab);
  if (filters.q) params.set('q', filters.q);
  if (filters.page > 1) params.set('page', String(filters.page));
  if (filters.ticket) params.set('ticket', filters.ticket);
  return params;
}

/** Số ticket của tab ("Đang xử lý" = OPEN + ANSWERED, "Tất cả" = tổng). */
export function ticketTabCount(
  tab: TicketTab,
  counts: TicketStatusCounts | undefined,
): number | undefined {
  if (!counts) return undefined;
  const statuses = ticketTabStatuses(tab);
  const keys = statuses.length > 0 ? statuses : (Object.keys(counts) as TicketStatus[]);
  return keys.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
}

/** Ô tìm kiếm: rỗng → bỏ lọc; quá dài → lỗi tiếng Việt. */
export function validateTicketSearch(text: string): { q?: string; error?: string } {
  const q = text.trim();
  if (q.length > MAX_TICKET_SEARCH_LENGTH) {
    return { error: `Từ khoá tối đa ${MAX_TICKET_SEARCH_LENGTH} ký tự.` };
  }
  return { q: q || undefined };
}

export interface NewTicketErrors {
  subject?: string;
  message?: string;
}

/** Validate form "Tạo yêu cầu hỗ trợ mới" (khớp CreateTicketDto, tính sau khi trim). */
export function validateNewTicket(input: { subject: string; message: string }): NewTicketErrors {
  const errors: NewTicketErrors = {};
  const subject = input.subject.trim();
  const message = input.message.trim();
  if (!subject) errors.subject = 'Vui lòng nhập tiêu đề yêu cầu.';
  else if (subject.length > MAX_SUBJECT_LENGTH)
    errors.subject = `Tiêu đề tối đa ${MAX_SUBJECT_LENGTH} ký tự.`;
  if (!message) errors.message = 'Vui lòng mô tả vấn đề bạn gặp phải.';
  else if (message.length > MAX_MESSAGE_LENGTH)
    errors.message = `Nội dung tối đa ${formatNumber(MAX_MESSAGE_LENGTH)} ký tự.`;
  return errors;
}

/** Validate tin nhắn trả lời (khớp AddTicketMessageDto). */
export function validateReply(body: string): string | undefined {
  const text = body.trim();
  if (!text) return 'Vui lòng nhập nội dung tin nhắn.';
  if (text.length > MAX_MESSAGE_LENGTH)
    return `Tin nhắn tối đa ${formatNumber(MAX_MESSAGE_LENGTH)} ký tự.`;
  return undefined;
}
