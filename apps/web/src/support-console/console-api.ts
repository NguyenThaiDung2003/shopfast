import { api } from '../api/client';
import type { PageMeta } from '../products/product-api';
import type { TicketStatusCounts } from '../support/my-tickets-filters';
import type { TicketCategory, TicketStatus } from '../support/ticket-meta';
import type { Ticket, TicketDetail } from '../support/tickets-api';
import type {
  AssistantOutcome,
  PendingActionStatus,
  PendingActionType,
  ToolCall,
} from './assistant-view';
import { QUEUE_PAGE_SIZE, queueTabStatus, type QueueFilters } from './console-filters';

/** TicketDto nhân viên nhận thêm thông tin khách. */
export interface QueueTicket extends Ticket {
  customer?: { id: string; fullName: string; email: string };
}

export type StaffTicketDetail = TicketDetail & Pick<QueueTicket, 'customer'>;

/** Khớp CountedTicketPageDto. */
export interface QueuePage {
  items: QueueTicket[];
  meta: PageMeta;
  statusCounts: TicketStatusCounts;
}

/** Khớp PendingActionDto. */
export interface PendingAction {
  id: string;
  type: PendingActionType;
  status: PendingActionStatus;
  summary: string;
  reason: string;
  orderId: string;
  orderCode: string;
  ticketId: string | null;
  ticketCode: string | null;
  decisionNote: string | null;
  errorCode: string | null;
  createdAt: string;
}

/** Khớp AssistantReplyDto. */
export interface AssistantReply {
  outcome: AssistantOutcome;
  reply: string;
  toolCalls: ToolCall[];
  pendingActions: PendingAction[];
}

export type Decision = 'confirm' | 'reject';

/** Danh sách không phụ thuộc ticket đang mở. */
export function queueQuery(filters: QueueFilters) {
  return {
    status: queueTabStatus(filters.tab),
    category: filters.category,
    q: filters.q,
    page: filters.page,
    limit: QUEUE_PAGE_SIZE,
  };
}

/** Chi tiết ticket dùng chung khoá `ticketKeys.detail` để `useReplyTicket` cập nhật được. */
export const consoleKeys = {
  queueAll: ['console', 'queue'] as const,
  queue: (filters: QueueFilters) => ['console', 'queue', queueQuery(filters)] as const,
  pendingAll: ['console', 'pending'] as const,
  pending: (ticketId: string) => ['console', 'pending', ticketId] as const,
};

export function fetchQueue(filters: QueueFilters, signal?: AbortSignal): Promise<QueuePage> {
  return api.get<QueuePage>('/support/tickets', { query: queueQuery(filters), signal });
}

export function fetchStaffTicket(id: string, signal?: AbortSignal): Promise<StaffTicketDetail> {
  return api.get<StaffTicketDetail>(`/support/tickets/${id}`, { signal });
}

export function updateTicket(
  id: string,
  change: { status?: Extract<TicketStatus, 'OPEN' | 'CLOSED'>; category?: TicketCategory },
): Promise<StaffTicketDetail> {
  return api.patch<StaffTicketDetail>(`/support/tickets/${id}`, change);
}

export function askAssistant(ticketId: string, question: string): Promise<AssistantReply> {
  return api.post<AssistantReply>(`/support/tickets/${ticketId}/assistant`, { question });
}

/** Đề xuất đang chờ của một ticket (mới nhất trước). */
export function fetchPendingActions(
  ticketId: string,
  signal?: AbortSignal,
): Promise<{ items: PendingAction[]; meta: PageMeta }> {
  return api.get('/support/pending-actions', {
    query: { status: 'PENDING', ticketId, limit: 20 },
    signal,
  });
}

export function decidePendingAction(
  id: string,
  decision: Decision,
  note?: string,
): Promise<PendingAction> {
  return api.post<PendingAction>(`/support/pending-actions/${id}/${decision}`, { note });
}
