import { Icon } from '../components/ui';
import { cn } from '../lib/cn';
import { formatRelativeTime } from '../lib/format';
import { TicketCategoryChips, TicketStatusBadge } from '../support/TicketTags';
import type { QueueTicket } from './console-api';

/** Thẻ ticket trong "Hàng đợi ticket"; thẻ đang mở có viền trái cam như thiết kế. */
export function QueueItem({
  ticket,
  selected,
  onSelect,
}: {
  ticket: QueueTicket;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(ticket.id)}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'relative flex w-full flex-col gap-space-xs rounded-xl p-space-md text-left transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        selected
          ? 'bg-surface-container-lowest shadow-card-hover'
          : 'bg-surface-container-low hover:bg-surface-container-lowest hover:shadow-card',
      )}
    >
      {selected && (
        <span
          aria-hidden
          className="absolute bottom-0 left-0 top-0 w-1 rounded-l-xl bg-secondary-container"
        />
      )}
      <span className="flex items-center justify-between gap-space-xs">
        <span
          className={cn(
            'text-title-sm font-bold',
            selected ? 'text-primary' : 'text-on-surface-variant',
          )}
        >
          #{ticket.code}
        </span>
        <TicketStatusBadge status={ticket.status} />
      </span>
      <span className="truncate text-title-md text-on-surface">
        {ticket.customer?.fullName ?? 'Khách hàng'}
      </span>
      <span className="line-clamp-2 text-body-sm text-on-surface-variant">{ticket.subject}</span>
      <span className="mt-space-xs flex flex-wrap items-center justify-between gap-space-xs">
        <span className="flex flex-wrap gap-space-xs">
          <TicketCategoryChips ticket={ticket} />
        </span>
        <span className="flex items-center gap-space-xs text-label-sm text-on-surface-variant">
          <Icon name="schedule" className="text-sm" />
          {formatRelativeTime(ticket.lastMessageAt)}
        </span>
      </span>
    </button>
  );
}
