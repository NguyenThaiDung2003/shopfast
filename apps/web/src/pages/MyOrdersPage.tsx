import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api/errors';
import { Breadcrumb } from '../components/Breadcrumb';
import { Button, Card, EmptyState, Icon, Pagination, Spinner, Tabs } from '../components/ui';
import { cn } from '../lib/cn';
import { formatNumber } from '../lib/format';
import { fetchMyOrders, orderKeys } from '../orders/my-orders-api';
import {
  ORDER_TABS,
  parseOrderFilters,
  tabCount,
  toOrderSearchParams,
  validateSearch,
  type OrderFilters,
  type OrderTab,
} from '../orders/my-orders-filters';
import { OrderCard } from '../orders/OrderCard';
import { useReorder } from '../orders/useReorder';

function OrdersSkeleton() {
  return (
    <div role="status" aria-label="Đang tải đơn hàng" className="animate-pulse space-y-space-md">
      {[0, 1, 2].map((i) => (
        <Card key={i} flush className="overflow-hidden">
          <div className="h-12 bg-surface-container-low" />
          <div className="flex gap-space-md p-space-lg">
            <div className="h-20 w-20 rounded-lg bg-surface-container-low" />
            <div className="flex-1 space-y-space-sm">
              <div className="h-4 w-2/3 rounded bg-surface-container-high" />
              <div className="h-4 w-1/3 rounded bg-surface-container-high" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

/** Ô tìm theo mã đơn / tên sản phẩm (pill, như thiết kế); validate trước khi ghi lên URL. */
function OrderSearch({ initial, onSearch }: { initial: string; onSearch: (q?: string) => void }) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string>();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validateSearch(text);
    setError(result.error);
    if (!result.error) onSearch(result.q);
  };

  return (
    <form role="search" onSubmit={submit} noValidate className="w-full md:w-96">
      <div
        className={cn(
          'flex items-center rounded-full bg-surface-container-low py-space-xs pl-space-lg pr-space-xs focus-within:ring-2',
          error ? 'ring-2 ring-error' : 'focus-within:ring-primary',
        )}
      >
        <Icon name="search" className="mr-space-sm text-outline" />
        <input
          type="search"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(undefined);
          }}
          aria-label="Tìm theo mã đơn hoặc tên sản phẩm"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'order-search-error' : undefined}
          placeholder="Tìm theo mã đơn hoặc tên sản phẩm…"
          className="w-full min-w-0 bg-transparent text-body-md text-on-surface placeholder:text-outline focus:outline-none"
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
            className="mr-space-xs rounded-full p-space-xs text-outline hover:text-on-surface"
          >
            <Icon name="close" className="text-lg" />
          </button>
        )}
        <button
          type="submit"
          className="shrink-0 rounded-full bg-primary px-space-lg py-space-sm text-label-md text-on-primary transition-colors hover:bg-primary-container"
        >
          Tìm
        </button>
      </div>
      {error && (
        <p id="order-search-error" className="mt-space-xs px-space-lg text-body-sm text-error">
          {error}
        </p>
      )}
    </form>
  );
}

/** Trang "Đơn hàng của tôi" (thiết kế apps/web/design/don-hang-cua-toi). */
export function MyOrdersPage() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseOrderFilters(params), [params]);
  const update = useCallback(
    (patch: Partial<OrderFilters>) =>
      setParams(toOrderSearchParams({ ...filters, page: 1, ...patch })),
    [filters, setParams],
  );
  const { reorder, pendingOrderId } = useReorder();

  const query = useQuery({
    queryKey: orderKeys.mine(filters),
    queryFn: ({ signal }) => fetchMyOrders(filters, signal),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const counts = data?.statusCounts;
  const totalOrders = tabCount('all', counts);

  const goToPage = (page: number) => {
    update({ page });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const renderList = () => {
    if (query.isPending) return <OrdersSkeleton />;
    if (query.isError && !data) {
      return (
        <Card>
          <EmptyState
            icon="cloud_off"
            title="Không tải được danh sách đơn hàng"
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
              title="Trang này không có đơn hàng"
              action={
                <Button variant="brand" onClick={() => goToPage(1)}>
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
              title="Không có đơn phù hợp"
              description={
                filters.q
                  ? `Không tìm thấy đơn nào khớp “${filters.q}” trong mục này.`
                  : 'Bạn chưa có đơn hàng nào ở trạng thái này.'
              }
              action={
                <Button variant="brand" onClick={() => setParams(new URLSearchParams())}>
                  Xem tất cả đơn
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon="shopping_bag"
              title="Bạn chưa có đơn hàng nào"
              description="Khám phá sản phẩm và đặt đơn đầu tiên của bạn."
              action={
                <Link
                  to="/san-pham"
                  className="inline-flex h-10 items-center gap-space-sm rounded-lg bg-secondary-container px-space-lg text-title-sm text-on-secondary transition-colors hover:bg-secondary"
                >
                  <Icon name="storefront" className="text-lg" />
                  Mua sắm ngay
                </Link>
              }
            />
          )}
        </Card>
      );
    }

    const refreshing = query.isPlaceholderData && query.isFetching;
    return (
      <div className="relative space-y-space-md" aria-busy={refreshing}>
        <div className={cn('space-y-space-md transition-opacity', refreshing && 'opacity-50')}>
          {data.items.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              reordering={pendingOrderId === order.id}
              onReorder={(o) => void reorder(o)}
            />
          ))}
        </div>
        {refreshing && (
          <div className="absolute inset-x-0 top-16 flex justify-center text-primary">
            <Spinner size="lg" label="Đang cập nhật danh sách" />
          </div>
        )}
        <Card className="p-space-md">
          <Pagination
            page={data.meta.page}
            pageSize={data.meta.limit}
            total={data.meta.total}
            onPageChange={goToPage}
            itemLabel="đơn hàng"
          />
        </Card>
      </div>
    );
  };

  return (
    <div className="space-y-space-lg">
      <Breadcrumb items={[{ label: 'Tài khoản của tôi' }, { label: 'Đơn hàng của tôi' }]} />

      <Card className="flex flex-col gap-space-lg p-space-lg md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-space-md">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-primary">
            <Icon name="package_2" className="text-3xl" />
          </div>
          <div>
            <h1 className="flex flex-wrap items-baseline gap-space-sm text-headline-md text-on-surface">
              Đơn hàng của tôi
              {totalOrders !== undefined && (
                <span className="text-body-lg font-normal text-on-surface-variant">
                  ({formatNumber(totalOrders)} đơn hàng)
                </span>
              )}
            </h1>
            <p className="text-body-md text-on-surface-variant">
              Theo dõi tình trạng thanh toán, xử lý và giao hàng của đơn đã đặt.
            </p>
          </div>
        </div>
        <OrderSearch
          key={filters.q ?? ''}
          initial={filters.q ?? ''}
          onSearch={(q) => update({ q })}
        />
      </Card>

      <Card flush className="px-space-sm">
        <Tabs<OrderTab>
          label="Lọc đơn theo trạng thái"
          value={filters.tab}
          onChange={(tab) => update({ tab })}
          className="border-b-0"
          items={ORDER_TABS.map((tab) => ({
            value: tab.value,
            label: tab.label,
            count: tabCount(tab.value, counts),
          }))}
        />
      </Card>

      {renderList()}
    </div>
  );
}
