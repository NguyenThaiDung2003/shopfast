import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage, isApiError } from '../api/errors';
import { Badge, Button, Icon, Spinner, Textarea, useToast } from '../components/ui';
import { cn } from '../lib/cn';
import { formatDateTime, formatDayTime } from '../lib/format';
import { MAX_MESSAGE_LENGTH, validateReply } from './my-tickets-filters';
import { isStaffAuthor, routingNotice, TICKET_STATUS_META } from './ticket-meta';
import { TICKET_POLL_MS, type TicketDetail, type TicketMessage } from './tickets-api';
import { TicketCategoryChips, TicketStatusBadge } from './TicketTags';
import { useReplyTicket } from './useReplyTicket';

function MessageBubble({ message }: { message: TicketMessage }) {
  const staff = isStaffAuthor(message.author.role);
  const time = formatDayTime(message.createdAt);
  if (!staff) {
    return (
      <article aria-label="Tin nhắn của bạn" className="flex items-end justify-end gap-space-sm">
        <div className="flex max-w-[85%] flex-col items-end sm:max-w-xl">
          <p className="whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-space-lg py-space-md text-body-md text-on-primary shadow-card">
            {message.body}
          </p>
          <p className="mt-space-xs flex items-center gap-space-xs text-label-sm text-outline">
            {time} • Đã gửi
            <Icon name="done_all" className="text-sm text-secondary-container" />
          </p>
        </div>
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-fixed text-primary ring-2 ring-primary/20"
        >
          <Icon name="person" className="text-lg" />
        </span>
      </article>
    );
  }
  return (
    <article
      aria-label={`Tin nhắn của ${message.author.fullName}`}
      className="flex items-end justify-start gap-space-sm"
    >
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary-fixed text-on-secondary-fixed ring-2 ring-secondary-container/40"
      >
        <Icon name="support_agent" className="text-lg" />
      </span>
      <div className="flex max-w-[85%] flex-col items-start sm:max-w-xl">
        <p className="mb-space-xs flex flex-wrap items-center gap-space-xs">
          <span className="text-title-sm font-bold text-on-surface">{message.author.fullName}</span>
          <Badge tone="primary" icon="verified">
            Chuyên viên CSKH
          </Badge>
        </p>
        <p className="whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-surface-container-low px-space-lg py-space-md text-body-md text-on-surface shadow-card">
          {message.body}
        </p>
        <p className="mt-space-xs text-label-sm text-outline">{time} • CSKH ShopFast</p>
      </div>
    </article>
  );
}

function ReplyForm({ ticket }: { ticket: TicketDetail }) {
  const toast = useToast();
  const id = useId();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>();
  const reply = useReplyTicket(ticket.id, {
    onSuccess: () => {
      setDraft('');
      setError(undefined);
    },
    onError: (err) => {
      if (isApiError(err) && err.code === 'TICKET_CLOSED') {
        toast.show({ tone: 'warning', title: 'Yêu cầu đã đóng', description: err.message });
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
      aria-label="Trả lời yêu cầu"
      className="border-t border-surface-container-high p-space-md"
    >
      <Textarea
        id={`${id}-reply`}
        label={<span className="sr-only">Tin nhắn trả lời</span>}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(undefined);
        }}
        onKeyDown={onKeyDown}
        error={error}
        hint="Ctrl + Enter để gửi nhanh"
        counterMax={MAX_MESSAGE_LENGTH}
        rows={3}
        placeholder="Nhập tin nhắn phản hồi cho chuyên viên hỗ trợ…"
        className="border-transparent bg-surface-container-low focus:bg-surface-container-lowest"
      />
      <div className="mt-space-sm flex justify-end">
        <Button type="submit" variant="primary" loading={reply.isPending} iconRight="send">
          Gửi
        </Button>
      </div>
    </form>
  );
}

/**
 * Khung hội thoại của một ticket (cột phải trang Hỗ trợ). Ticket chưa có realtime nên trang
 * làm mới định kỳ; `refreshing` hiện trạng thái đó ở thanh dưới.
 */
export function TicketConversation({
  ticket,
  refreshing,
  onBack,
  onCreateNew,
}: {
  ticket: TicketDetail;
  refreshing: boolean;
  /** Mobile: quay về danh sách. */
  onBack: () => void;
  onCreateNew: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const count = ticket.messages.length;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ticket.id, count]);

  return (
    <section
      aria-label={`Hội thoại yêu cầu #${ticket.code}`}
      className="flex min-h-[560px] flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-card lg:min-h-[720px]"
    >
      <header className="space-y-space-md border-b border-surface-container-high p-space-lg">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-space-xs text-label-md text-primary lg:hidden"
        >
          <Icon name="arrow_back" className="text-lg" />
          Danh sách yêu cầu
        </button>
        <div className="space-y-space-xs">
          <p className="flex flex-wrap items-center gap-space-xs">
            <span className="text-title-sm font-bold text-primary">Yêu cầu #{ticket.code}</span>
            <span className="text-outline" aria-hidden>
              •
            </span>
            <span className="text-body-sm text-outline">
              Tạo lúc: {formatDateTime(ticket.createdAt)}
            </span>
          </p>
          <h2 className="break-words text-headline-sm font-extrabold text-on-surface">
            {ticket.subject}
          </h2>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-space-sm rounded-xl bg-surface-container-low/60 p-space-md">
          <div className="flex flex-wrap items-center gap-space-xs">
            {ticket.orderId && ticket.orderCode && (
              <Link
                to={`/don-hang/${ticket.orderId}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-lowest px-space-md py-space-xs text-label-sm font-bold text-primary shadow-card transition-colors hover:bg-primary-fixed"
              >
                <Icon name="local_mall" className="text-sm" />
                Đơn hàng: #{ticket.orderCode}
                <Icon name="arrow_forward" className="text-xs" />
              </Link>
            )}
            <TicketCategoryChips ticket={ticket} size="md" />
          </div>
          <TicketStatusBadge status={ticket.status} size="md" />
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 space-y-space-lg overflow-y-auto p-space-lg lg:max-h-[500px]"
      >
        <div className="flex items-start gap-space-md rounded-xl bg-surface-container-low p-space-md">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-primary">
            <Icon name="smart_toy" className="text-lg" />
          </span>
          <div className="space-y-0.5">
            <p className="text-label-sm font-bold uppercase tracking-wider text-primary">
              Hệ thống điều phối tự động ShopFast AI
            </p>
            <p className="text-body-sm text-on-surface-variant">{routingNotice(ticket)}</p>
          </div>
        </div>
        {ticket.messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>

      <div className="flex items-center justify-between gap-space-sm border-t border-surface-container-high/60 bg-surface-container-low/50 px-space-lg py-space-sm text-body-sm text-on-surface-variant">
        <p className="flex items-center gap-space-sm" role="status">
          {refreshing ? (
            <>
              <Spinner size="sm" label="" className="h-3 w-3" />
              Đang cập nhật tin nhắn…
            </>
          ) : (
            <>
              <span aria-hidden className="h-2 w-2 rounded-full bg-tertiary-container" />
              Tự động cập nhật mỗi {TICKET_POLL_MS / 1000} giây
            </>
          )}
        </p>
        <p className="hidden items-center gap-space-xs text-outline sm:flex">
          <Icon name="schedule" className="text-sm" />
          {TICKET_STATUS_META[ticket.status].hint}
        </p>
      </div>

      {ticket.status === 'CLOSED' ? (
        <div
          className={cn(
            'flex flex-col items-start gap-space-md border-t border-surface-container-high p-space-lg',
            'sm:flex-row sm:items-center sm:justify-between',
          )}
        >
          <p className="flex items-center gap-space-sm text-body-md text-on-surface-variant">
            <Icon name="lock" className="text-lg" />
            Yêu cầu này đã đóng, không thể gửi thêm tin nhắn.
          </p>
          <Button variant="primary" icon="add_circle" onClick={onCreateNew}>
            Tạo yêu cầu mới
          </Button>
        </div>
      ) : (
        <ReplyForm key={ticket.id} ticket={ticket} />
      )}
    </section>
  );
}
