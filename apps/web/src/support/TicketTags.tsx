import { Badge, Icon } from '../components/ui';
import { cn } from '../lib/cn';
import { TICKET_CATEGORY_META, TICKET_STATUS_META, type TicketStatus } from './ticket-meta';
import type { Ticket } from './tickets-api';

/** Pill trạng thái ticket – nhãn/màu lấy từ TICKET_STATUS_META. */
export function TicketStatusBadge({
  status,
  size = 'sm',
}: {
  status: TicketStatus;
  size?: 'sm' | 'md';
}) {
  const meta = TICKET_STATUS_META[status];
  return (
    <Badge tone={meta.tone} pill size={size}>
      {status !== 'CLOSED' && (
        <span
          aria-hidden
          className={cn(
            'h-2 w-2 rounded-full',
            status === 'OPEN' ? 'animate-pulse bg-secondary-container' : 'bg-primary',
          )}
        />
      )}
      {meta.label}
    </Badge>
  );
}

/** Chip nhóm vấn đề + chip "Phân loại AI" (khi LLM gán nhóm). */
export function TicketCategoryChips({
  ticket,
  size = 'sm',
}: {
  ticket: Pick<Ticket, 'category' | 'categorySource'>;
  size?: 'sm' | 'md';
}) {
  const category = ticket.category ? TICKET_CATEGORY_META[ticket.category] : null;
  return (
    <>
      {category ? (
        <Badge tone="brand" icon={category.icon} size={size} pill={size === 'md'}>
          {category.label}
        </Badge>
      ) : (
        <Badge tone="neutral" icon="hourglass_top" size={size} pill={size === 'md'}>
          Đang phân loại…
        </Badge>
      )}
      {ticket.categorySource === 'LLM' && (
        <Badge tone="primary" size={size} pill={size === 'md'}>
          <Icon name="auto_awesome" className="text-sm text-secondary-container" />
          Phân loại AI
        </Badge>
      )}
    </>
  );
}
