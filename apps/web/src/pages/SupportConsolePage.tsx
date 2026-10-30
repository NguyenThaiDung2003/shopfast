import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorMessage, isApiError } from '../api/errors';
import { Button, Card, EmptyState, Icon, Tabs } from '../components/ui';
import { cn } from '../lib/cn';
import { formatNumber } from '../lib/format';
import { ConsoleConversation } from '../support-console/ConsoleConversation';
import { consoleKeys, fetchQueue, fetchStaffTicket } from '../support-console/console-api';
import {
  DEFAULT_QUEUE_TAB,
  parseQueueFilters,
  toQueueSearchParams,
  type QueueFilters,
} from '../support-console/console-filters';
import { CopilotPanel } from '../support-console/CopilotPanel';
import { TicketQueue } from '../support-console/TicketQueue';
import { TICKET_POLL_MS, ticketKeys } from '../support/tickets-api';

type MobilePane = 'chat' | 'copilot';

/** Desktop (≥ lg) hiện hàng đợi cạnh hội thoại nên tự mở ticket đầu; mobile thì không. */
function isDesktop(): boolean {
  return (
    typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1024px)').matches
  );
}

function ConversationSkeleton() {
  return (
    <Card
      role="status"
      aria-label="Đang tải ticket"
      className="min-h-[600px] animate-pulse space-y-space-lg"
    >
      <div className="h-6 w-1/3 rounded bg-surface-container-high" />
      <div className="h-4 w-2/3 rounded bg-surface-container-high" />
      <div className="h-14 rounded-xl bg-surface-container-low" />
      <div className="h-20 w-2/3 rounded-2xl bg-surface-container-low" />
      <div className="ml-auto h-20 w-2/3 rounded-2xl bg-surface-container-high" />
    </Card>
  );
}

/** "Bàn làm việc CSKH & Trợ lý AI" (thiết kế ban-lam-viec-cham-soc-khach-hang-va-tro-ly-ai). */
export function SupportConsolePage() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseQueueFilters(params), [params]);
  const [pane, setPane] = useState<MobilePane>('chat');

  const update = useCallback(
    (patch: Partial<QueueFilters>, replace = false) =>
      setParams(toQueueSearchParams({ ...filters, page: 1, ...patch }), { replace }),
    [filters, setParams],
  );
  const select = (ticket?: string) => {
    setPane('chat');
    update({ ticket, page: filters.page });
  };

  const queue = useQuery({
    queryKey: consoleKeys.queue(filters),
    queryFn: ({ signal }) => fetchQueue(filters, signal),
    placeholderData: keepPreviousData,
    refetchInterval: TICKET_POLL_MS,
  });
  const detail = useQuery({
    queryKey: ticketKeys.detail(filters.ticket ?? ''),
    queryFn: ({ signal }) => fetchStaffTicket(filters.ticket!, signal),
    enabled: Boolean(filters.ticket),
    refetchInterval: TICKET_POLL_MS,
  });

  const firstId = queue.data?.items[0]?.id;
  useEffect(() => {
    if (!filters.ticket && firstId && !queue.isPlaceholderData && isDesktop()) {
      update({ ticket: firstId, page: filters.page }, true);
    }
  }, [filters.ticket, filters.page, firstId, queue.isPlaceholderData, update]);

  const openCount = queue.data?.statusCounts.OPEN;
  const selected = Boolean(filters.ticket);

  const renderConversation = () => {
    if (!filters.ticket) {
      return (
        <Card className="flex min-h-[600px] items-center justify-center">
          <EmptyState
            icon="forum"
            title="Chọn một ticket trong hàng đợi"
            description="Hội thoại với khách và Copilot sẽ hiện ở đây."
          />
        </Card>
      );
    }
    if (detail.isPending) return <ConversationSkeleton />;
    if (detail.isError) {
      const notFound = isApiError(detail.error) && [400, 404].includes(detail.error.status);
      return (
        <Card className="flex min-h-[400px] items-center justify-center">
          <EmptyState
            icon={notFound ? 'search_off' : 'cloud_off'}
            title={notFound ? 'Không tìm thấy ticket' : 'Không tải được ticket'}
            description={notFound ? 'Ticket không tồn tại.' : errorMessage(detail.error)}
            action={
              notFound ? (
                <Button variant="brand" icon="arrow_back" onClick={() => select(undefined)}>
                  Về hàng đợi
                </Button>
              ) : (
                <Button
                  variant="brand"
                  icon="refresh"
                  loading={detail.isFetching}
                  onClick={() => void detail.refetch()}
                >
                  Thử lại
                </Button>
              )
            }
          />
        </Card>
      );
    }
    return <ConsoleConversation ticket={detail.data} refreshing={detail.isFetching} />;
  };

  // Ba cột cần 2xl: breakpoint tính theo màn hình, trong khi sidebar nhân viên đã chiếm 16rem.
  return (
    <div className="space-y-space-md">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h1 className="flex items-center gap-space-sm text-headline-sm text-primary">
          <Icon name="support_agent" className="text-2xl" />
          Bàn điều hành hỗ trợ trực tuyến
        </h1>
        <div className="flex flex-wrap items-center gap-space-sm text-label-md">
          {openCount !== undefined && (
            <span className="flex items-center gap-space-xs rounded-full bg-secondary-fixed px-space-md py-space-xs text-on-secondary-fixed">
              <span aria-hidden className="h-2 w-2 rounded-full bg-secondary-container" />
              {formatNumber(openCount)} ticket chờ xử lý
            </span>
          )}
          <span className="flex items-center gap-space-xs rounded-full bg-tertiary-fixed px-space-md py-space-xs text-on-tertiary-fixed">
            <span aria-hidden className="h-2 w-2 rounded-full bg-tertiary-container" />
            Làm mới mỗi {TICKET_POLL_MS / 1000} giây
          </span>
        </div>
      </div>

      {selected && (
        <div className="flex items-center justify-between gap-space-sm lg:hidden">
          <Button variant="ghost" size="sm" icon="arrow_back" onClick={() => select(undefined)}>
            Hàng đợi
          </Button>
          <Tabs<MobilePane>
            variant="segmented"
            label="Chọn khung làm việc"
            value={pane}
            onChange={setPane}
            className="w-56"
            items={[
              { value: 'chat', label: 'Hội thoại' },
              { value: 'copilot', label: 'Copilot' },
            ]}
          />
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-space-md lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)] 2xl:grid-cols-[20rem_minmax(0,1fr)_24rem]">
        <div className={cn('lg:row-span-2 2xl:row-span-1', selected ? 'hidden lg:block' : 'block')}>
          <TicketQueue
            filters={filters}
            query={queue}
            onChange={(patch) => update(patch)}
            onSelect={select}
            onReset={() => setParams(toQueueSearchParams({ tab: DEFAULT_QUEUE_TAB, page: 1 }))}
          />
        </div>

        <div className={cn('min-w-0', !selected || pane !== 'chat' ? 'hidden lg:block' : 'block')}>
          {renderConversation()}
        </div>

        {filters.ticket && detail.isSuccess && (
          <div
            className={cn(
              'min-w-0 lg:col-start-2 2xl:col-start-3 2xl:row-start-1',
              pane === 'copilot' ? 'block' : 'hidden lg:block',
            )}
          >
            <CopilotPanel ticketId={filters.ticket} />
          </div>
        )}
      </div>
    </div>
  );
}
