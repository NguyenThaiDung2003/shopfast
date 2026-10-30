import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { keepsIdempotencyKey, newIdempotencyKey } from '../lib/idempotency';
import { createTicket, ticketKeys, type NewTicketInput, type TicketDetail } from './tickets-api';

/**
 * Tạo ticket với Idempotency-Key sinh MỘT lần cho mỗi lần gửi (như `cart/usePlaceOrder.ts`):
 * giữ key khi lỗi thử lại được, bỏ key khi thành công, lỗi nghiệp vụ hoặc nội dung form đổi.
 */
export function useCreateTicket(options: {
  onSuccess: (ticket: TicketDetail) => void;
  onError: (error: unknown) => void;
}) {
  const queryClient = useQueryClient();
  const keyRef = useRef<string | null>(null);

  const mutation = useMutation({
    mutationFn: ({ input, key }: { input: NewTicketInput; key: string }) =>
      createTicket(input, key),
    onSuccess: (ticket) => {
      keyRef.current = null;
      queryClient.setQueryData(ticketKeys.detail(ticket.id), ticket);
      void queryClient.invalidateQueries({ queryKey: ticketKeys.allMine });
      options.onSuccess(ticket);
    },
    onError: (error) => {
      if (!keepsIdempotencyKey(error)) keyRef.current = null;
      options.onError(error);
    },
  });

  const submit = (input: NewTicketInput) => {
    if (mutation.isPending) return;
    keyRef.current ??= newIdempotencyKey();
    mutation.mutate({ input, key: keyRef.current });
  };

  /** Nội dung form vừa đổi → lần gửi sau là yêu cầu mới. */
  const resetKey = useCallback(() => {
    keyRef.current = null;
  }, []);

  return { submit, resetKey, isPending: mutation.isPending };
}
