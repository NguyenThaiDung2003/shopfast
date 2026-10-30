import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorMessage, isApiError } from '../api/errors';
import { Breadcrumb } from '../components/Breadcrumb';
import { Button, Card, EmptyState, Icon, Pagination, Tabs, useToast } from '../components/ui';
import { cn } from '../lib/cn';
import { formatNumber } from '../lib/format';
import { isUuid } from '../lib/uuid';
import {
  parseTicketFilters,
  TICKET_TABS,
  ticketTabCount,
  toTicketSearchParams,
  validateTicketSearch,
  type TicketFilters,
  type TicketTab,
} from '../support/my-tickets-filters';
import { NewTicketModal } from '../support/NewTicketModal';
import { supportContacts } from '../support/support-contacts';
import { TicketConversation } from '../support/TicketConversation';
import { TicketListItem } from '../support/TicketListItem';
import {
  fetchMyTickets,
  fetchTicket,
  TICKET_POLL_MS,
  ticketKeys,
  type TicketDetail,
} from '../support/tickets-api';

const CONTACTS = supportContacts(import.meta.env);

/** Desktop (≥ lg) hiện cả hai cột; mobile chỉ một cột nên không tự mở ticket đầu tiên. */
function isDesktop(): boolean {
  return (
    typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1024px)').matches
  );
}

function ListSkeleton() {
  return (
    <div
      role="status"
      aria-label="Đang tải danh sách yêu cầu"
      className="animate-pulse space-y-space-sm"
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="space-y-space-sm rounded-xl bg-surface-container-lowest p-space-lg shadow-card"
        >
          <div className="h-4 w-1/3 rounded bg-surface-container-high" />
          <div className="h-4 w-full rounded bg-surface-container-high" />
          <div className="h-4 w-1/2 rounded bg-surface-container-low" />
        </div>
      ))}
    </div>
  );
}

function ConversationSkeleton() {
  return (
    <Card
      role="status"
      aria-label="Đang tải hội thoại"
      className="min-h-[560px] animate-pulse space-y-space-lg lg:min-h-[720px]"
    >
      <div className="h-4 w-1/4 rounded bg-surface-container-high" />
      <div className="h-6 w-2/3 rounded bg-surface-container-high" />
      <div className="h-12 rounded-xl bg-surface-container-low" />
      <div className="ml-auto h-16 w-2/3 rounded-2xl bg-surface-container-high" />
      <div className="h-16 w-2/3 rounded-2xl bg-surface-container-low" />
    </Card>
  );
}

/** Ô tìm theo mã ticket / tiêu đề; validate trước khi ghi lên URL. */
function TicketSearch({ initial, onSearch }: { initial: string; onSearch: (q?: string) => void }) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string>();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validateTicketSearch(text);
    setError(result.error);
    if (!result.error) onSearch(result.q);
  };

  return (
    <form role="search" onSubmit={submit} noValidate>
      <div
        className={cn(
          'flex items-center rounded-lg bg-surface-container-low pl-space-md pr-space-xs focus-within:bg-surface-container-lowest focus-within:ring-2',
          error ? 'ring-2 ring-error' : 'focus-within:ring-primary',
        )}
      >
        <Icon name="search" className="mr-space-sm text-lg text-outline" />
        <input
          type="search"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(undefined);
          }}
          aria-label="Tìm theo mã ticket hoặc tiêu đề"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'ticket-search-error' : undefined}
          placeholder="Tìm theo mã ticket, tiêu đề…"
          className="h-10 w-full min-w-0 bg-transparent text-body-sm text-on-surface placeholder:text-outline focus:outline-none"
        />
        {initial && (
          <button
            type="button"
            onClick={() => {
              setText('');
              setError(undefined);
              onSearch(undefined);
            }}
            aria-label="Xoá từ khoá"
            className="rounded-full p-space-xs text-outline hover:text-on-surface"
          >
            <Icon name="close" className="text-lg" />
          </button>
        )}
        <button
          type="submit"
          className="shrink-0 rounded-md px-space-sm py-space-xs text-label-md text-primary hover:bg-surface-container-high"
        >
          Tìm
        </button>
      </div>
      {error && (
        <p id="ticket-search-error" className="mt-space-xs text-body-sm text-error">
          {error}
        </p>
      )}
    </form>
  );
}

/** Trang "Hỗ trợ khách hàng" (thiết kế apps/web/design/ho-tro-khach-hang). */
export function SupportPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseTicketFilters(params), [params]);
  const orderParam = params.get('don');
  const [creating, setCreating] = useState(() => isUuid(orderParam));

  const update = useCallback(
    (patch: Partial<TicketFilters>, replace = false) =>
      setParams(toTicketSearchParams({ ...filters, page: 1, ...patch }), { replace }),
    [filters, setParams],
  );
  const selectTicket = (ticket?: string) => update({ ticket, page: filters.page });

  const list = useQuery({
    queryKey: ticketKeys.mine(filters),
    queryFn: ({ signal }) => fetchMyTickets(filters, signal),
    placeholderData: keepPreviousData,
    refetchInterval: TICKET_POLL_MS,
  });
  const detail = useQuery({
    queryKey: ticketKeys.detail(filters.ticket ?? ''),
    queryFn: ({ signal }) => fetchTicket(filters.ticket!, signal),
    enabled: Boolean(filters.ticket),
    refetchInterval: TICKET_POLL_MS,
  });

  const data = list.data;
  const counts = data?.statusCounts;
  const firstId = data?.items[0]?.id;

  // Desktop: chưa chọn ticket thì mở ticket đầu tiên (replace để Back không kẹt ở URL cũ).
  useEffect(() => {
    if (!filters.ticket && firstId && !list.isPlaceholderData && isDesktop()) {
      update({ ticket: firstId, page: filters.page }, true);
    }
  }, [filters.ticket, filters.page, firstId, list.isPlaceholderData, update]);

  const closeModal = () => {
    setCreating(false);
    if (orderParam !== null) setParams(toTicketSearchParams(filters), { replace: true });
  };

  const onCreated = (ticket: TicketDetail) => {
    setCreating(false);
    toast.show({
      tone: 'success',
      title: 'Đã gửi yêu cầu hỗ trợ',
      description: `Mã yêu cầu ${ticket.code}. CSKH sẽ phản hồi trong thời gian sớm nhất.`,
    });
    setParams(toTicketSearchParams({ tab: 'all', page: 1, ticket: ticket.id }));
  };

  const renderList = () => {
    if (list.isPending) return <ListSkeleton />;
    if (list.isError && !data) {
      return (
        <Card>
          <EmptyState
            icon="cloud_off"
            title="Không tải được danh sách yêu cầu"
            description={errorMessage(list.error)}
            action={
              <Button
                variant="brand"
                icon="refresh"
                loading={list.isFetching}
                onClick={() => void list.refetch()}
              >
                Thử lại
              </Button>
            }
          />
        </Card>
      );
    }
    if (!data) return null;

    if (data.items.length === 0) {
      const filtered = filters.tab !== 'all' || Boolean(filters.q);
      if (data.meta.total > 0) {
        return (
          <Card>
            <EmptyState
              icon="last_page"
              title="Trang này không có yêu cầu"
              action={
                <Button variant="brand" onClick={() => update({ page: 1 })}>
                  Về trang đầu
                </Button>
              }
            />
          </Card>
        );
      }
      return (
        <Card>
          {filtered ? (
            <EmptyState
              icon="search_off"
              title="Không có yêu cầu phù hợp"
              description={
                filters.q
                  ? `Không tìm thấy yêu cầu nào khớp “${filters.q}” trong mục này.`
                  : 'Bạn không có yêu cầu nào ở trạng thái này.'
              }
              action={
                <Button variant="brand" onClick={() => setParams(new URLSearchParams())}>
                  Xem tất cả
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon="support_agent"
              title="Bạn chưa có yêu cầu hỗ trợ nào"
              description="Gặp vấn đề với đơn hàng, vận chuyển hay thanh toán? Gửi yêu cầu để CSKH hỗ trợ bạn."
              action={
                <Button variant="primary" icon="add_circle" onClick={() => setCreating(true)}>
                  Tạo yêu cầu mới
                </Button>
              }
            />
          )}
        </Card>
      );
    }

    const refreshing = list.isPlaceholderData && list.isFetching;
    return (
      <div className="space-y-space-sm" aria-busy={refreshing}>
        <ul
          aria-label="Yêu cầu hỗ trợ"
          className={cn('space-y-space-sm transition-opacity', refreshing && 'opacity-50')}
        >
          {data.items.map((ticket) => (
            <li key={ticket.id}>
              <TicketListItem
                ticket={ticket}
                selected={ticket.id === filters.ticket}
                onSelect={selectTicket}
              />
            </li>
          ))}
        </ul>
        {data.meta.totalPages > 1 && (
          <Card className="p-space-md">
            <Pagination
              page={data.meta.page}
              pageSize={data.meta.limit}
              total={data.meta.total}
              onPageChange={(page) => update({ page })}
              itemLabel="yêu cầu"
            />
          </Card>
        )}
      </div>
    );
  };

  const renderConversation = () => {
    if (!filters.ticket) {
      return (
        <Card className="flex min-h-[560px] items-center justify-center lg:min-h-[720px]">
          <EmptyState
            icon="forum"
            title="Chọn một yêu cầu để xem hội thoại"
            description="Hoặc tạo yêu cầu mới nếu bạn cần hỗ trợ thêm."
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
            title={notFound ? 'Không tìm thấy yêu cầu' : 'Không tải được hội thoại'}
            description={
              notFound
                ? 'Yêu cầu không tồn tại hoặc không thuộc tài khoản của bạn.'
                : errorMessage(detail.error)
            }
            action={
              notFound ? (
                <Button variant="brand" icon="arrow_back" onClick={() => selectTicket(undefined)}>
                  Về danh sách yêu cầu
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
    return (
      <TicketConversation
        ticket={detail.data}
        refreshing={detail.isFetching}
        onBack={() => selectTicket(undefined)}
        onCreateNew={() => setCreating(true)}
      />
    );
  };

  return (
    <div className="space-y-space-lg">
      <div className="space-y-space-md">
        <Breadcrumb items={[{ label: 'Hỗ trợ khách hàng' }, { label: 'Yêu cầu hỗ trợ của tôi' }]} />
        <div className="flex flex-col justify-between gap-space-lg lg:flex-row lg:items-center">
          <div className="max-w-3xl space-y-space-xs">
            <p className="inline-flex items-center gap-space-xs rounded-full bg-primary-fixed px-space-md py-space-xs text-label-sm font-semibold text-on-primary-fixed">
              <Icon name="headset_mic" className="text-base text-primary" />
              Trung tâm Chăm sóc Khách hàng
            </p>
            <h1 className="text-headline-lg-mobile text-on-surface md:text-headline-lg">
              Trung tâm Hỗ trợ &amp; Chăm sóc Khách hàng
            </h1>
            <p className="text-body-md text-on-surface-variant">
              Đội ngũ ShopFast CSKH luôn sẵn sàng đồng hành cùng bạn. Mọi thắc mắc về đơn hàng, vận
              chuyển, đổi trả và thanh toán đều được tiếp nhận và phản hồi ngay tại đây.
            </p>
          </div>
          <Button
            variant="primary"
            size="lg"
            icon="add_circle"
            onClick={() => setCreating(true)}
            className="shrink-0 self-start lg:self-auto"
          >
            Tạo yêu cầu mới
          </Button>
        </div>

        {CONTACTS.length > 0 && (
          <ul aria-label="Kênh liên hệ" className="grid grid-cols-1 gap-space-md sm:grid-cols-3">
            {CONTACTS.map((contact) => (
              <li key={contact.key}>
                <a
                  href={contact.href}
                  {...(contact.external && { target: '_blank', rel: 'noreferrer' })}
                  className="group flex items-center gap-space-md rounded-xl bg-surface-container-lowest p-space-md shadow-card transition-shadow hover:shadow-card-hover"
                >
                  <span
                    className={cn(
                      'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105',
                      contact.key === 'hotline'
                        ? 'bg-secondary-fixed text-on-secondary-fixed'
                        : contact.key === 'chat'
                          ? 'bg-primary-fixed text-on-primary-fixed'
                          : 'bg-surface-container text-on-surface-variant',
                    )}
                  >
                    <Icon name={contact.icon} className="text-2xl" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-label-sm uppercase tracking-wider text-outline">
                      {contact.label}
                    </span>
                    <span
                      className={cn(
                        'block truncate text-title-md',
                        contact.key === 'hotline'
                          ? 'font-extrabold text-secondary-container'
                          : contact.key === 'chat'
                            ? 'font-bold text-primary'
                            : 'text-on-surface',
                      )}
                    >
                      {contact.value}
                    </span>
                    {contact.note && (
                      <span className="block text-body-sm text-outline">{contact.note}</span>
                    )}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-1 items-start gap-space-lg lg:grid-cols-12">
        <aside
          aria-label="Danh sách yêu cầu"
          className={cn(
            'flex-col gap-space-md lg:col-span-4',
            filters.ticket ? 'hidden lg:flex' : 'flex',
          )}
        >
          <Card className="space-y-space-md">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-space-sm text-title-md font-bold text-on-surface">
                <Icon name="confirmation_number" className="text-xl text-primary" />
                Danh sách yêu cầu
              </h2>
              {data && (
                <span className="rounded-full bg-primary-fixed px-space-sm py-0.5 text-label-sm font-bold text-on-primary-fixed">
                  {formatNumber(ticketTabCount('all', counts) ?? 0)} phiếu
                </span>
              )}
            </div>
            <TicketSearch
              key={filters.q ?? ''}
              initial={filters.q ?? ''}
              onSearch={(q) => update({ q })}
            />
            <Tabs<TicketTab>
              variant="segmented"
              label="Lọc yêu cầu theo trạng thái"
              value={filters.tab}
              onChange={(tab) => update({ tab })}
              items={TICKET_TABS.map((tab) => ({
                value: tab.value,
                label: tab.label,
                count: ticketTabCount(tab.value, counts),
              }))}
            />
          </Card>
          {renderList()}
        </aside>

        <div className={cn('lg:col-span-8', filters.ticket ? 'block' : 'hidden lg:block')}>
          {renderConversation()}
        </div>
      </div>

      {creating && (
        <NewTicketModal
          defaultOrderId={isUuid(orderParam) ? orderParam : undefined}
          onClose={closeModal}
          onCreated={onCreated}
        />
      )}
    </div>
  );
}
