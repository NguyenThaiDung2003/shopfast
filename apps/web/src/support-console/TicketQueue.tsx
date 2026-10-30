import type { UseQueryResult } from '@tanstack/react-query';
import { errorMessage } from '../api/errors';
import { Button, Card, EmptyState, Pagination, SearchInput, Tabs } from '../components/ui';
import { cn } from '../lib/cn';
import { formatNumber } from '../lib/format';
import { TICKET_CATEGORY_META, type TicketCategory } from '../support/ticket-meta';
import { TICKET_POLL_MS } from '../support/tickets-api';
import type { QueuePage } from './console-api';
import {
  QUEUE_TABS,
  queueTabCount,
  validateQueueSearch,
  type QueueFilters,
  type QueueTab,
} from './console-filters';
import { QueueItem } from './QueueItem';

const CATEGORIES = Object.entries(TICKET_CATEGORY_META) as Array<
  [TicketCategory, { label: string; icon: string }]
>;

function QueueSkeleton() {
  return (
    <div role="status" aria-label="Đang tải hàng đợi" className="animate-pulse space-y-space-sm">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-space-sm rounded-xl bg-surface-container-low p-space-md">
          <div className="h-4 w-1/3 rounded bg-surface-container-high" />
          <div className="h-4 w-2/3 rounded bg-surface-container-high" />
          <div className="h-3 w-full rounded bg-surface-container-high" />
        </div>
      ))}
    </div>
  );
}

/** Cột "Hàng đợi ticket": tìm, lọc nhóm (chip), lọc trạng thái (tab có số), danh sách. */
export function TicketQueue({
  filters,
  query,
  onChange,
  onSelect,
  onReset,
}: {
  filters: QueueFilters;
  query: UseQueryResult<QueuePage>;
  onChange: (patch: Partial<QueueFilters>) => void;
  onSelect: (id: string) => void;
  onReset: () => void;
}) {
  const data = query.data;
  const counts = data?.statusCounts;

  const renderList = () => {
    if (query.isPending) return <QueueSkeleton />;
    if (query.isError && !data) {
      return (
        <EmptyState
          icon="cloud_off"
          title="Không tải được hàng đợi"
          description={errorMessage(query.error)}
          action={
            <Button
              variant="brand"
              icon="refresh"
              loading={query.isFetching}
              onClick={() => void query.refetch()}
            >
              Thử lại
            </Button>
          }
        />
      );
    }
    if (!data) return null;
    if (data.items.length === 0) {
      const filtered = Boolean(filters.category || filters.q);
      return filtered ? (
        <EmptyState
          icon="search_off"
          title="Không có ticket phù hợp"
          description="Thử bỏ bớt bộ lọc hoặc đổi từ khoá."
          action={
            <Button variant="brand" onClick={onReset}>
              Xoá bộ lọc
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon="task_alt"
          title={filters.tab === 'open' ? 'Không có ticket chờ xử lý' : 'Không có ticket nào'}
          description="Ticket mới của khách sẽ tự xuất hiện ở đây."
        />
      );
    }
    const refreshing = query.isPlaceholderData && query.isFetching;
    return (
      <div className="space-y-space-sm" aria-busy={refreshing}>
        <ul
          aria-label="Hàng đợi ticket"
          className={cn('space-y-space-sm transition-opacity', refreshing && 'opacity-50')}
        >
          {data.items.map((ticket) => (
            <li key={ticket.id}>
              <QueueItem
                ticket={ticket}
                selected={ticket.id === filters.ticket}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
        {data.meta.totalPages > 1 && (
          <Pagination
            page={data.meta.page}
            pageSize={data.meta.limit}
            total={data.meta.total}
            onPageChange={(page) => onChange({ page })}
            itemLabel="ticket"
          />
        )}
      </div>
    );
  };

  return (
    <Card className="flex flex-col gap-space-md p-space-md">
      <div className="flex items-center justify-between gap-space-sm">
        <h2 className="text-headline-sm text-on-surface">Hàng đợi ticket</h2>
        {counts && (
          <span className="rounded-full bg-primary-fixed px-space-sm py-0.5 text-label-sm font-bold text-on-primary-fixed">
            {formatNumber(counts.OPEN)} chờ xử lý
          </span>
        )}
      </div>
      <SearchInput
        key={filters.q ?? ''}
        initial={filters.q ?? ''}
        onSearch={(q) => onChange({ q })}
        validate={validateQueueSearch}
        label="Tìm ticket"
        placeholder="Tìm mã ticket, tên/email khách, mã đơn…"
      />
      <div
        role="group"
        aria-label="Lọc theo nhóm vấn đề"
        className="-mx-space-md flex gap-space-xs overflow-x-auto px-space-md pb-space-xs"
      >
        {[undefined, ...CATEGORIES.map(([value]) => value)].map((value) => {
          const active = filters.category === value;
          return (
            <button
              key={value ?? 'all'}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ category: value })}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-full px-space-md py-1.5 text-label-md transition-colors',
                active
                  ? 'bg-primary-container text-on-primary'
                  : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high',
              )}
            >
              {value ? TICKET_CATEGORY_META[value].label : 'Tất cả'}
            </button>
          );
        })}
      </div>
      <Tabs<QueueTab>
        variant="segmented"
        label="Lọc theo trạng thái ticket"
        value={filters.tab}
        onChange={(tab) => onChange({ tab })}
        items={QUEUE_TABS.map((tab) => ({
          value: tab.value,
          label: tab.label,
          count: queueTabCount(tab.value, counts),
        }))}
      />
      {renderList()}
      <p className="flex items-center gap-space-xs border-t border-surface-container-high pt-space-sm text-label-sm text-on-surface-variant">
        <span aria-hidden className="h-2 w-2 rounded-full bg-tertiary-container" />
        Tự động làm mới mỗi {TICKET_POLL_MS / 1000} giây
      </p>
    </Card>
  );
}
