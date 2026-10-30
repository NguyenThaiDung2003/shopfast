import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api/errors';
import {
  Button,
  Card,
  EmptyState,
  Icon,
  OrderStatusBadge,
  Pagination,
  SearchInput,
  Select,
  Table,
  Tabs,
  useToast,
  type TableColumn,
} from '../components/ui';
import { cn } from '../lib/cn';
import { formatDateTime, formatNumber, formatPrice, formatRelativeTime } from '../lib/format';
import { ORDER_STATUS_META, type OrderStatus } from '../orders/order-status';
import {
  ORDER_TABS,
  PAGE_SIZES,
  parseOrderFilters,
  toOrderSearchParams,
  validateOrderSearch,
  type OrderTab,
  type WarehouseOrderFilters,
} from '../warehouse/orders-filters';
import { TransitionModal } from '../warehouse/TransitionModal';
import { transitionActions, type TransitionAction } from '../warehouse/transition-view';
import {
  fetchStaffOrders,
  WAREHOUSE_POLL_MS,
  warehouseKeys,
  type StaffOrder,
} from '../warehouse/warehouse-api';

/** Thẻ thống kê đầu trang – bấm để lọc theo trạng thái. */
const STAT_STATUSES: readonly OrderStatus[] = ['PENDING_PAYMENT', 'PAID', 'PROCESSING', 'SHIPPING'];

/** Trang "Xử lý đơn kho" (thiết kế quan-ly-don-hang-kho). */
export function WarehouseOrdersPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseOrderFilters(params), [params]);
  const [pending, setPending] = useState<{ order: StaffOrder; action: TransitionAction }>();

  const update = useCallback(
    (patch: Partial<WarehouseOrderFilters>) =>
      setParams(toOrderSearchParams({ ...filters, page: 1, ...patch })),
    [filters, setParams],
  );

  const query = useQuery({
    queryKey: warehouseKeys.orders(filters),
    queryFn: ({ signal }) => fetchStaffOrders(filters, signal),
    placeholderData: keepPreviousData,
    refetchInterval: WAREHOUSE_POLL_MS,
  });
  const data = query.data;
  const counts = data?.statusCounts;
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined;

  const copyCode = (code: string) => {
    void navigator.clipboard?.writeText(code).then(
      () => toast.show({ tone: 'info', title: `Đã sao chép mã đơn ${code}` }),
      () => undefined,
    );
  };

  const columns: TableColumn<StaffOrder>[] = [
    {
      key: 'code',
      header: 'Mã đơn',
      render: (order) => (
        <div className="flex items-center gap-space-xs">
          <span className="text-title-sm font-bold text-primary">#{order.code}</span>
          <button
            type="button"
            onClick={() => copyCode(order.code)}
            aria-label={`Sao chép mã đơn ${order.code}`}
            className="rounded p-0.5 text-outline hover:text-primary"
          >
            <Icon name="content_copy" className="text-base" />
          </button>
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Khách hàng',
      className: 'min-w-[180px]',
      render: (order) => (
        <div>
          <p className="text-title-sm text-on-surface">{order.customer?.fullName ?? '—'}</p>
          <p className="text-body-sm text-on-surface-variant">{order.customer?.email}</p>
          <p
            className={cn(
              'text-label-sm',
              order.paidAt ? 'text-tertiary-container' : 'text-secondary',
            )}
          >
            {order.paidAt ? 'Đã thanh toán' : 'Chưa thanh toán'}
          </p>
        </div>
      ),
    },
    {
      key: 'createdAt',
      header: 'Thời gian tạo',
      className: 'min-w-[140px]',
      render: (order) => (
        <div>
          <p className="text-body-md text-on-surface">{formatDateTime(order.createdAt)}</p>
          <p className="text-body-sm text-on-surface-variant">
            {formatRelativeTime(order.createdAt)}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      render: (order) => <OrderStatusBadge status={order.status} size="sm" />,
    },
    {
      key: 'items',
      header: 'Sản phẩm',
      className: 'min-w-[200px]',
      render: (order) => (
        <div>
          <p className="text-title-sm text-on-surface">
            {order.items.reduce((sum, item) => sum + item.quantity, 0)} sản phẩm
          </p>
          <p className="line-clamp-2 text-body-sm text-on-surface-variant">
            {order.items.map((item) => item.name).join(', ')}
          </p>
        </div>
      ),
    },
    {
      key: 'total',
      header: 'Tổng tiền',
      align: 'right',
      render: (order) => (
        <span className="whitespace-nowrap text-price-sm text-on-surface">
          {formatPrice(order.totalAmount)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Thao tác chuyển bước',
      align: 'right',
      className: 'min-w-[220px]',
      render: (order) => {
        const actions = transitionActions(order.nextStatuses);
        if (actions.length === 0) {
          return (
            <span className="inline-flex items-center gap-space-xs text-body-sm text-on-surface-variant">
              <Icon name="verified" className="text-base" />
              Đã hoàn tất
            </span>
          );
        }
        return (
          <div className="flex flex-wrap justify-end gap-space-xs">
            {actions.map((action) => (
              <Button
                key={action.to}
                size="sm"
                variant={action.kind === 'cancel' ? 'ghost' : 'primary'}
                icon={action.icon}
                className={cn(action.kind === 'cancel' && 'text-error')}
                aria-label={`${action.label} – đơn ${order.code}`}
                onClick={() => setPending({ order, action })}
              >
                {action.label}
              </Button>
            ))}
          </div>
        );
      },
    },
  ];

  const filtered = filters.tab !== 'all' || Boolean(filters.q);
  const empty = filtered ? (
    <EmptyState
      icon="search_off"
      title="Không có đơn phù hợp"
      description="Thử đổi trạng thái hoặc từ khoá tìm kiếm."
      action={
        <Button variant="brand" onClick={() => setParams(new URLSearchParams())}>
          Xem tất cả đơn
        </Button>
      }
    />
  ) : (
    <EmptyState icon="inventory_2" title="Chưa có đơn hàng nào" />
  );

  return (
    <div className="space-y-space-lg">
      <div className="flex flex-wrap items-center justify-between gap-space-md">
        <div className="flex flex-wrap items-center gap-space-md">
          <h1 className="text-headline-lg-mobile text-on-surface md:text-headline-lg">
            Quản lý đơn hàng kho
          </h1>
          {total !== undefined && (
            <span className="rounded-full bg-secondary-fixed px-space-md py-space-xs text-label-md text-on-secondary-fixed">
              {formatNumber(total)} đơn
            </span>
          )}
        </div>
        <Button
          variant="outline"
          icon="refresh"
          loading={query.isFetching && !query.isPending}
          onClick={() => void query.refetch()}
        >
          Làm mới
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-space-md lg:grid-cols-4">
        {STAT_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            aria-pressed={filters.tab === status}
            onClick={() => update({ tab: filters.tab === status ? 'all' : status })}
            className={cn(
              'flex items-center gap-space-md rounded-xl bg-surface-container-lowest p-space-md text-left shadow-card transition-shadow hover:shadow-card-hover',
              filters.tab === status && 'ring-2 ring-primary',
            )}
          >
            <span
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                ORDER_STATUS_META[status].className,
              )}
            >
              <Icon name={ORDER_STATUS_META[status].icon} className="text-xl" />
            </span>
            <span>
              <span className="block text-body-sm text-on-surface-variant">
                {ORDER_STATUS_META[status].label}
              </span>
              <span className="block text-headline-sm text-on-surface">
                {counts ? `${formatNumber(counts[status])} đơn` : '—'}
              </span>
            </span>
          </button>
        ))}
      </div>

      <Card flush className="overflow-hidden">
        <div className="space-y-space-md border-b border-surface-container-high p-space-md">
          <Tabs<OrderTab>
            label="Lọc đơn theo trạng thái"
            value={filters.tab}
            onChange={(tab) => update({ tab })}
            items={ORDER_TABS.map((tab) => ({
              value: tab.value,
              label: tab.label,
              count: counts ? (tab.value === 'all' ? total : counts[tab.value]) : undefined,
            }))}
          />
          <SearchInput
            key={filters.q ?? ''}
            initial={filters.q ?? ''}
            onSearch={(q) => update({ q })}
            validate={validateOrderSearch}
            label="Tìm đơn hàng"
            placeholder="Tìm mã đơn, tên/email khách, tên sản phẩm…"
            className="md:max-w-md"
          />
        </div>

        {query.isError && !data ? (
          <EmptyState
            icon="cloud_off"
            title="Không tải được danh sách đơn"
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
        ) : (
          <Table
            caption="Danh sách đơn hàng kho"
            columns={columns}
            rows={data?.items}
            rowKey={(order) => order.id}
            loading={query.isPending || (query.isPlaceholderData && query.isFetching)}
            empty={empty}
          />
        )}

        {data && data.meta.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-space-md border-t border-surface-container-high p-space-md">
            <Pagination
              page={data.meta.page}
              pageSize={data.meta.limit}
              total={data.meta.total}
              onPageChange={(page) => update({ page })}
              itemLabel="đơn hàng"
              className="flex-1"
            />
            <Select
              label="Số dòng"
              value={String(filters.limit)}
              onChange={(e) => update({ limit: Number(e.target.value) })}
              options={PAGE_SIZES.map((size) => ({
                value: String(size),
                label: `${size} / trang`,
              }))}
              containerClassName="w-36"
            />
          </div>
        )}
      </Card>

      {pending && (
        <TransitionModal
          order={pending.order}
          action={pending.action}
          onClose={() => setPending(undefined)}
        />
      )}
    </div>
  );
}
