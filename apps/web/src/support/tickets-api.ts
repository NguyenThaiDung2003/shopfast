import { api } from '../api/client';
import type { Role } from '../auth/roles';
import type { PageMeta } from '../products/product-api';
import {
  TICKET_PAGE_SIZE,
  ticketTabStatuses,
  type TicketFilters,
  type TicketStatusCounts,
} from './my-tickets-filters';
import type { CategorySource, TicketCategory, TicketStatus } from './ticket-meta';

/** Khớp TicketDto (khách không nhận trường `customer`). */
export interface Ticket {
  id: string;
  code: string;
  subject: string;
  status: TicketStatus;
  category: TicketCategory | null;
  categorySource: CategorySource | null;
  orderId: string | null;
  orderCode: string | null;
  lastMessageAt: string;
  createdAt: string;
}

/** Khớp TicketMessageDto. */
export interface TicketMessage {
  id: number;
  body: string;
  createdAt: string;
  author: { role: Role; fullName: string };
}

/** Khớp TicketDetailDto – tin nhắn cũ nhất trước. */
export interface TicketDetail extends Ticket {
  messages: TicketMessage[];
}

/** Khớp MyTicketPageDto. */
export interface MyTicketPage {
  items: Ticket[];
  meta: PageMeta;
  statusCounts: TicketStatusCounts;
}

export interface NewTicketInput {
  subject: string;
  message: string;
  orderId?: string;
}

/** Ticket chưa có realtime → làm mới định kỳ khi tab trình duyệt đang mở. */
export const TICKET_POLL_MS = 20_000;

/** Danh sách không phụ thuộc ticket đang mở (`ticket` trên URL). */
export function myTicketsQuery(filters: TicketFilters) {
  const statuses = ticketTabStatuses(filters.tab);
  return {
    status: statuses.length > 0 ? statuses.join(',') : undefined,
    q: filters.q,
    page: filters.page,
    limit: TICKET_PAGE_SIZE,
  };
}

export const ticketKeys = {
  allMine: ['tickets', 'me'] as const,
  mine: (filters: TicketFilters) => ['tickets', 'me', myTicketsQuery(filters)] as const,
  detail: (id: string) => ['tickets', 'detail', id] as const,
};

export function fetchMyTickets(
  filters: TicketFilters,
  signal?: AbortSignal,
): Promise<MyTicketPage> {
  return api.get<MyTicketPage>('/support/tickets/me', { query: myTicketsQuery(filters), signal });
}

export function fetchTicket(id: string, signal?: AbortSignal): Promise<TicketDetail> {
  return api.get<TicketDetail>(`/support/tickets/${id}`, { signal });
}

export function createTicket(input: NewTicketInput, idempotencyKey: string): Promise<TicketDetail> {
  return api.post<TicketDetail>('/support/tickets', input, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export function replyTicket(id: string, body: string): Promise<TicketDetail> {
  return api.post<TicketDetail>(`/support/tickets/${id}/messages`, { body });
}
