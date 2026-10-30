import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isApiError } from '../api/errors';
import { replyTicket, ticketKeys, type TicketDetail } from './tickets-api';

/**
 * Gửi tin nhắn vào ticket. API không nhận Idempotency-Key cho tin nhắn nên nút gửi bị khoá
 * trong lúc chờ để không gửi trùng. Ticket vừa bị đóng (409 TICKET_CLOSED) → tải lại để
 * khung hội thoại chuyển sang trạng thái khoá; bản nháp do component giữ lại.
 */
export function useReplyTicket(
  ticketId: string,
  options: {
    onSuccess: (ticket: TicketDetail) => void;
    onError: (error: unknown) => void;
    /** Danh sách cần làm mới sau khi gửi (mặc định: "Ticket của tôi"). */
    listKey?: readonly unknown[];
  },
) {
  const listKey = options.listKey ?? ticketKeys.allMine;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => replyTicket(ticketId, body),
    onSuccess: (ticket) => {
      queryClient.setQueryData(ticketKeys.detail(ticket.id), ticket);
      void queryClient.invalidateQueries({ queryKey: listKey });
      options.onSuccess(ticket);
    },
    onError: (error) => {
      if (isApiError(error) && error.code === 'TICKET_CLOSED') {
        void queryClient.invalidateQueries({ queryKey: ticketKeys.detail(ticketId) });
        void queryClient.invalidateQueries({ queryKey: listKey });
      }
      options.onError(error);
    },
  });
}
