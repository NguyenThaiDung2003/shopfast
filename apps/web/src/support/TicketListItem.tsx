import { Icon } from '../components/ui';
import { cn } from '../lib/cn';
import { formatDayTime } from '../lib/format';
import type { Ticket } from './tickets-api';
import { TicketCategoryChips, TicketStatusBadge } from './TicketTags';

/** Thẻ ticket ở cột "Danh sách yêu cầu"; thẻ đang mở có thanh primary bên trái. */
export function TicketListItem({
  ticket,
  selected,
  onSelect,
}: {
  ticket: Ticket;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const closed = ticket.status === 'CLOSED';
  return (
    <button
      type="button"
      onClick={() => onSelect(ticket.id)}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'relative flex w-full flex-col gap-space-sm rounded-xl p-space-lg text-left transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        selected
          ? 'bg-surface-container-high shadow-card-hover'
          : 'bg-surface-container-lowest shadow-card hover:shadow-card-hover',
        closed && !selected && 'opacity-90 hover:opacity-100',
      )}
    >
      {selected && (
        <span
          aria-hidden
          className="absolute bottom-3 left-0 top-3 w-1.5 rounded-r-full bg-primary"
        />
      )}
      <span className="flex items-center justify-between gap-space-xs">
        <span
          className={cn(
            'text-title-sm font-bold',
            selected ? 'text-primary' : closed ? 'text-outline' : 'text-on-surface',
          )}
        >
          #{ticket.code}
        </span>
        <TicketStatusBadge status={ticket.status} />
      </span>
      <span className="line-clamp-2 text-title-sm text-on-surface">{ticket.subject}</span>
      <span className="flex flex-wrap items-center gap-space-xs">
        <TicketCategoryChips ticket={ticket} />
      </span>
      <span className="flex items-center justify-between gap-space-sm border-t border-outline-variant/20 pt-space-xs text-body-sm text-outline">
        <span className="flex min-w-0 items-center gap-space-xs">
          <Icon name="shopping_bag" className="text-sm" />
          <span className="truncate">
            {ticket.orderCode ? `Đơn #${ticket.orderCode}` : 'Không gắn đơn'}
          </span>
        </span>
        <span className={cn('shrink-0', selected && 'font-medium text-primary')}>
          <span className="sr-only">Cập nhật lúc </span>
          {formatDayTime(ticket.lastMessageAt)}
        </span>
      </span>
    </button>
  );
}
