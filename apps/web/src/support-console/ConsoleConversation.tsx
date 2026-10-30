import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { errorMessage, isApiError } from '../api/errors';
import {
  Badge,
  Button,
  Icon,
  OrderStatusBadge,
  Select,
  Textarea,
  useToast,
} from '../components/ui';
import { cn } from '../lib/cn';
import { formatDateTime, formatDayTime, formatPrice } from '../lib/format';
import { fetchOrder, orderKeys } from '../orders/my-orders-api';
import { MAX_MESSAGE_LENGTH, validateReply } from '../support/my-tickets-filters';
import {
  isStaffAuthor,
  routingNotice,
  TICKET_CATEGORY_META,
  type TicketCategory,
} from '../support/ticket-meta';
import { ticketKeys, type TicketMessage } from '../support/tickets-api';
import { TicketStatusBadge } from '../support/TicketTags';
import { useReplyTicket } from '../support/useReplyTicket';
import { initials } from './assistant-view';
import { consoleKeys, updateTicket, type StaffTicketDetail } from './console-api';

const CATEGORY_OPTIONS = (
  Object.entries(TICKET_CATEGORY_META) as Array<[TicketCategory, { label: string }]>
).map(([value, meta]) => ({ value, label: meta.label }));

function Message({ message }: { message: TicketMessage }) {
  const staff = isStaffAuthor(message.author.role);
  const name = message.author.fullName;
  return (
    <article
      aria-label={`Tin nhắn của ${name}${staff ? ' (CSKH)' : ''}`}
      className={cn('flex items-start gap-space-sm', staff && 'flex-row-reverse')}
    >
      <span
        aria-hidden
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-label-md font-bold',
          staff ? 'bg-primary-container text-on-primary' : 'bg-primary-fixed text-primary',
        )}
      >
        {initials(name)}
      </span>
      <div className={cn('flex max-w-[85%] flex-col sm:max-w-xl', staff && 'items-end')}>
        <p
          className={cn(
            'mb-space-xs flex items-baseline gap-space-sm',
            staff && 'flex-row-reverse',
          )}
        >
          <span className={cn('text-title-sm', staff ? 'text-primary' : 'text-on-surface')}>
            {staff ? `${name} (CSKH)` : name}
          </span>
          <span className="text-label-sm text-outline">{formatDayTime(message.createdAt)}</span>
        </p>
        <p
          className={cn(
            'whitespace-pre-wrap break-words rounded-2xl px-space-lg py-space-md text-body-md shadow-card',
            staff
              ? 'rounded-tr-sm bg-primary-container text-on-primary'
              : 'rounded-tl-sm bg-surface-container-lowest text-on-surface',
          )}
        >
          {message.body}
        </p>
      </div>
    </article>
  );
}

/** Dải thông tin đơn liên quan (mã, tổng tiền, trạng thái thật từ GET /orders/:id). */
function OrderStrip({ orderId, orderCode }: { orderId: string; orderCode: string }) {
  const order = useQuery({
    queryKey: orderKeys.detail(orderId),
    queryFn: ({ signal }) => fetchOrder(orderId, signal),
  });
  return (
    <div
      aria-label="Đơn hàng liên quan"
      role="group"
      className="flex flex-wrap items-center gap-x-space-lg gap-y-space-sm rounded-xl bg-surface-container-low p-space-md"
    >
      <span className="flex items-center gap-space-sm text-title-sm text-primary">
        <Icon name="local_shipping" className="text-xl" />
        Đơn hàng: #{orderCode}
      </span>
      {order.data ? (
        <>
          <span className="text-price-md text-secondary-container">
            {formatPrice(order.data.totalAmount)}
          </span>
          <OrderStatusBadge status={order.data.status} size="sm" />
          <span className="text-body-sm text-on-surface-variant">
            {order.data.items.length} sản phẩm
            {order.data.paidAt ? ' • Đã thanh toán' : ' • Chưa thanh toán'}
          </span>
        </>
      ) : order.isError ? (
        <span className="text-body-sm text-on-surface-variant">Không tải được chi tiết đơn.</span>
      ) : (
        <span className="text-body-sm text-on-surface-variant">Đang tải đơn…</span>
      )}
    </div>
  );
}

function ReplyBox({ ticket }: { ticket: StaffTicketDetail }) {
  const toast = useToast();
  const id = useId();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>();
  const reply = useReplyTicket(ticket.id, {
    listKey: consoleKeys.queueAll,
    onSuccess: () => {
      setDraft('');
      setError(undefined);
    },
    onError: (err) => {
      if (isApiError(err) && err.code === 'TICKET_CLOSED') {
        toast.show({ tone: 'warning', title: 'Ticket đã đóng', description: err.message });
        return;
      }
      setError(errorMessage(err));
    },
  });

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (reply.isPending) return;
    const invalid = validateReply(draft);
    setError(invalid);
    if (!invalid) reply.mutate(draft.trim());
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submit();
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Phản hồi khách hàng"
      className="space-y-space-sm border-t border-surface-container-high p-space-md"
    >
      <Textarea
        id={`${id}-reply`}
        label={<span className="sr-only">Nội dung phản hồi</span>}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(undefined);
        }}
        onKeyDown={onKeyDown}
        error={error}
        counterMax={MAX_MESSAGE_LENGTH}
        rows={3}
        placeholder={`Nhập phản hồi gửi khách hàng ${ticket.customer?.fullName ?? ''}…`}
        className="border-transparent bg-surface-container-low focus:bg-surface-container-lowest"
      />
      <div className="flex items-center justify-between gap-space-md">
        <span className="text-label-sm text-on-surface-variant">Ctrl + Enter để gửi</span>
        <Button type="submit" variant="primary" loading={reply.isPending} iconRight="send">
          Gửi phản hồi
        </Button>
      </div>
    </form>
  );
}

/** Cột giữa: header ticket, đơn liên quan, banner phân loại, hội thoại, ô phản hồi. */
export function ConsoleConversation({
  ticket,
  refreshing,
}: {
  ticket: StaffTicketDetail;
  refreshing: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const count = ticket.messages.length;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ticket.id, count]);

  const update = useMutation({
    mutationFn: (change: Parameters<typeof updateTicket>[1]) => updateTicket(ticket.id, change),
    onSuccess: (updated, change) => {
      queryClient.setQueryData(ticketKeys.detail(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: consoleKeys.queueAll });
      toast.show({
        tone: 'success',
        title: change.status
          ? change.status === 'CLOSED'
            ? `Đã đóng ticket ${updated.code}`
            : `Đã mở lại ticket ${updated.code}`
          : `Đã chuyển ${updated.code} sang nhóm ${TICKET_CATEGORY_META[change.category!].label}`,
      });
    },
    onError: (error) =>
      toast.show({
        tone: 'error',
        title: 'Không cập nhật được ticket',
        description: errorMessage(error),
      }),
  });
  const closed = ticket.status === 'CLOSED';

  return (
    <section
      aria-label={`Ticket #${ticket.code}`}
      className="flex min-h-[600px] flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-card 2xl:h-[calc(100vh-8rem)]"
    >
      <header className="space-y-space-md border-b border-surface-container-high p-space-lg">
        <div className="flex flex-wrap items-start justify-between gap-space-md">
          <div className="min-w-[min(16rem,100%)] flex-1 space-y-space-xs">
            <h2 className="flex flex-wrap items-center gap-space-sm text-headline-md text-primary">
              Ticket #{ticket.code}
              <TicketStatusBadge status={ticket.status} size="md" />
            </h2>
            <p className="break-words text-title-md text-on-surface">{ticket.subject}</p>
            <p className="flex flex-wrap items-center gap-x-space-sm text-body-sm text-on-surface-variant">
              <span className="font-semibold text-on-surface">
                {ticket.customer?.fullName ?? 'Khách hàng'}
              </span>
              {ticket.customer?.email && (
                <>
                  <span aria-hidden>•</span>
                  <a href={`mailto:${ticket.customer.email}`} className="hover:text-primary">
                    {ticket.customer.email}
                  </a>
                </>
              )}
              <span aria-hidden>•</span>
              <span>Tạo lúc {formatDateTime(ticket.createdAt)}</span>
            </p>
          </div>
          <div className="flex max-w-full flex-wrap items-end gap-space-sm">
            <Select
              label="Nhóm vấn đề"
              value={ticket.category ?? ''}
              placeholder="Chưa phân loại"
              options={CATEGORY_OPTIONS}
              disabled={update.isPending}
              onChange={(e) => update.mutate({ category: e.target.value as TicketCategory })}
              containerClassName="w-48"
            />
            <Button
              variant={closed ? 'tonal' : 'outline'}
              icon={closed ? 'lock_open' : 'lock'}
              loading={update.isPending && update.variables?.status !== undefined}
              disabled={update.isPending}
              onClick={() => update.mutate({ status: closed ? 'OPEN' : 'CLOSED' })}
            >
              {closed ? 'Mở lại ticket' : 'Đóng ticket'}
            </Button>
          </div>
        </div>
        {ticket.orderId && ticket.orderCode && (
          <OrderStrip orderId={ticket.orderId} orderCode={ticket.orderCode} />
        )}
      </header>

      <div
        ref={scrollRef}
        className="flex-1 space-y-space-lg overflow-y-auto bg-surface-container-low/40 p-space-lg"
      >
        <p className="flex items-start gap-space-sm rounded-xl bg-primary-fixed/60 px-space-md py-space-sm text-label-md text-on-primary-fixed">
          <Icon name="info" className="text-lg" />
          {routingNotice(ticket)}
          {ticket.categorySource === 'LLM' && (
            <Badge tone="primary" icon="auto_awesome" className="ml-auto shrink-0">
              AI
            </Badge>
          )}
        </p>
        {ticket.messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
      </div>

      <p
        role="status"
        className="flex items-center gap-space-sm border-t border-surface-container-high px-space-lg py-1.5 text-label-sm text-on-surface-variant"
      >
        <span
          aria-hidden
          className={cn(
            'h-2 w-2 rounded-full',
            refreshing ? 'animate-pulse bg-secondary-container' : 'bg-tertiary-container',
          )}
        />
        {refreshing ? 'Đang cập nhật hội thoại…' : 'Hội thoại tự làm mới định kỳ'}
      </p>

      {closed ? (
        <div className="flex flex-col items-start gap-space-md border-t border-surface-container-high p-space-lg sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-space-sm text-body-md text-on-surface-variant">
            <Icon name="lock" className="text-lg" />
            Ticket đã đóng – mở lại để tiếp tục phản hồi khách.
          </p>
        </div>
      ) : (
        <ReplyBox key={ticket.id} ticket={ticket} />
      )}
    </section>
  );
}
