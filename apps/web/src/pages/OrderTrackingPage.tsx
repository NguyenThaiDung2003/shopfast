import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getFreshAccessToken } from '../api/client';
import { errorMessage, isApiError } from '../api/errors';
import { Breadcrumb } from '../components/Breadcrumb';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  OrderStatusBadge,
  useToast,
} from '../components/ui';
import { cn } from '../lib/cn';
import { formatDateTime, formatNumber, formatPrice } from '../lib/format';
import { fetchOrder, orderKeys, type OrderDetail } from '../orders/my-orders-api';
import { ORDER_STATUS_META } from '../orders/order-status';
import { buildTimeline, isOrderId } from '../orders/order-tracking';
import { OrderTimeline } from '../orders/OrderTimeline';
import { ConnectionIndicator } from '../realtime/ConnectionIndicator';
import { useOrderTracking } from '../realtime/useOrderTracking';

function NotFound() {
  return (
    <Card>
      <EmptyState
        icon="search_off"
        title="Không tìm thấy đơn hàng"
        description="Đơn hàng không tồn tại hoặc không thuộc tài khoản của bạn."
        action={
          <Link
            to="/don-hang"
            className="inline-flex h-10 items-center gap-space-sm rounded-lg bg-primary-container px-space-lg text-title-sm text-on-primary transition-colors hover:bg-primary"
          >
            <Icon name="arrow_back" className="text-lg" />
            Về đơn hàng của tôi
          </Link>
        }
      />
    </Card>
  );
}

function TrackingSkeleton() {
  const bar = 'rounded bg-surface-container-high';
  return (
    <div role="status" aria-label="Đang tải đơn hàng" className="animate-pulse space-y-space-lg">
      <Card className="space-y-space-sm">
        <div className={cn(bar, 'h-8 w-72')} />
        <div className={cn(bar, 'h-4 w-48')} />
      </Card>
      <div className="grid gap-space-lg lg:grid-cols-12">
        <Card className="h-80 lg:col-span-8" />
        <Card className="h-80 lg:col-span-4" />
      </div>
    </div>
  );
}

/** Trang "Theo dõi đơn hàng" (thiết kế apps/web/design/theo-doi-don-hang). */
export function OrderTrackingPage() {
  const { id } = useParams();
  const valid = isOrderId(id);
  const query = useQuery({
    queryKey: orderKeys.detail(id ?? ''),
    queryFn: ({ signal }) => fetchOrder(id as string, signal),
    enabled: valid,
  });

  if (!valid) return <NotFound />;
  if (isApiError(query.error) && (query.error.status === 404 || query.error.status === 400)) {
    return <NotFound />;
  }
  if (query.isPending) return <TrackingSkeleton />;
  if (query.isError) {
    return (
      <Card>
        <EmptyState
          icon="cloud_off"
          title="Không tải được thông tin đơn hàng"
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
  return <OrderTrackingView order={query.data} />;
}

function OrderTrackingView({ order }: { order: OrderDetail }) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const tracking = useOrderTracking([order.id], { getAccessToken: getFreshAccessToken });
  // Realtime có thể đi trước HTTP (vừa nhận order:updated, hoặc snapshot sau khi nối lại).
  const status = tracking.statuses[order.id] ?? order.status;

  // Trạng thái đổi (sự kiện realtime hoặc snapshot sau khi nối lại) → toast; nếu dữ liệu HTTP
  // chưa có chặng mới thì tải lại để có thời điểm/ghi chú.
  const shown = useRef(order.status);
  useEffect(() => {
    if (status === shown.current) return;
    shown.current = status;
    toast.show({
      tone: status === 'CANCELLED' ? 'warning' : 'info',
      title: 'Cập nhật đơn hàng',
      description: `Đơn ${order.code} đã chuyển sang ${ORDER_STATUS_META[status].label}.`,
    });
    if (status !== order.status) {
      void queryClient.invalidateQueries({ queryKey: orderKeys.detail(order.id) });
      void queryClient.invalidateQueries({ queryKey: orderKeys.allMine });
    }
  }, [status, order.status, order.code, order.id, queryClient, toast]);

  const timeline = buildTimeline(order, status);
  const meta = ORDER_STATUS_META[status];
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(order.code);
      toast.success('Đã sao chép mã đơn', order.code);
    } catch {
      toast.error('Không sao chép được', 'Hãy chọn và sao chép mã đơn thủ công.');
    }
  };

  return (
    <div className="space-y-space-lg">
      <Breadcrumb
        items={[
          { label: 'Đơn hàng của tôi', to: '/don-hang' },
          { label: `Theo dõi đơn hàng #${order.code}` },
        ]}
      />

      <Card className="flex flex-col gap-space-md p-space-lg md:flex-row md:items-center md:justify-between">
        <div className="space-y-space-xs">
          <h1 className="flex flex-wrap items-center gap-space-sm text-headline-lg-mobile text-on-surface md:text-headline-lg">
            Theo dõi đơn hàng <span className="text-primary">#{order.code}</span>
            <button
              type="button"
              onClick={() => void copyCode()}
              aria-label="Sao chép mã đơn"
              className="rounded-lg bg-surface-container-low p-space-xs text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            >
              <Icon name="content_copy" className="text-lg" />
            </button>
          </h1>
          <p className="flex items-center gap-space-xs text-body-md text-on-surface-variant">
            <Icon name="calendar_today" className="text-base" />
            Đặt lúc: {formatDateTime(order.createdAt)}
          </p>
        </div>
        <ConnectionIndicator
          connection={tracking.connection}
          subscribeError={tracking.errors[order.id]}
        />
      </Card>

      <div className="grid items-start gap-space-lg lg:grid-cols-12">
        <div className="space-y-space-lg lg:col-span-8">
          <Card className="space-y-space-lg p-space-lg">
            <div className="flex flex-wrap items-start justify-between gap-space-md">
              <div>
                <p className="text-label-md uppercase tracking-wider text-secondary">
                  Trạng thái hiện tại
                </p>
                <p
                  className={cn(
                    'mt-space-xs text-headline-lg-mobile md:text-display-hero',
                    timeline.cancelled ? 'text-error' : 'text-primary',
                  )}
                  data-testid="current-status"
                >
                  {meta.label}
                </p>
              </div>
              <OrderStatusBadge status={status} />
            </div>
            <div>
              <div className="mb-space-sm flex justify-between text-label-md text-on-surface-variant">
                <span>Đặt hàng</span>
                <span className={timeline.cancelled ? 'text-error' : 'text-primary'}>
                  {timeline.cancelled
                    ? 'Đơn đã huỷ'
                    : `Chặng ${timeline.stepNumber}/${timeline.totalSteps}: ${meta.label}`}
                </span>
                <span>Giao thành công</span>
              </div>
              <div
                role="progressbar"
                aria-label="Tiến độ đơn hàng"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={timeline.percent}
                className="h-2.5 overflow-hidden rounded-full bg-surface-container-high"
              >
                <div
                  className={cn(
                    'h-full rounded-full transition-[width] duration-500',
                    timeline.cancelled ? 'bg-error' : 'bg-primary-container',
                  )}
                  style={{ width: `${timeline.percent}%` }}
                />
              </div>
            </div>
          </Card>

          <Card className="p-space-lg">
            <h2 className="mb-space-lg flex items-center gap-space-sm text-headline-sm text-on-surface">
              <Icon name="route" className="text-primary" />
              Chi tiết lịch trình đơn hàng
            </h2>
            <OrderTimeline steps={timeline.steps} />
          </Card>
        </div>

        <aside className="space-y-space-lg lg:col-span-4" aria-label="Thông tin đơn hàng">
          <Card className="space-y-space-md p-space-lg">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-space-sm text-headline-sm text-on-surface">
                <Icon name="payments" className="text-primary" />
                Thanh toán
              </h2>
              <Badge tone={order.paidAt ? 'success' : 'neutral'} className="uppercase">
                {order.paidAt ? 'Đã thanh toán' : 'Chưa thanh toán'}
              </Badge>
            </div>
            <p className="text-body-md text-on-surface-variant">
              {order.paidAt
                ? `Đã nhận thanh toán lúc ${formatDateTime(order.paidAt)}.`
                : 'Đơn chưa được thanh toán.'}
            </p>
          </Card>

          <Card className="space-y-space-md p-space-lg">
            <h2 className="flex items-center gap-space-sm text-headline-sm text-on-surface">
              <Icon name="package_2" className="text-primary" />
              Kiện hàng gồm {formatNumber(itemCount)} sản phẩm
            </h2>
            <ul className="space-y-space-md">
              {order.items.map((item) => (
                <li key={item.productId} className="flex gap-space-md">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-surface-container-low">
                    <Icon name="inventory_2" className="text-2xl text-primary-fixed-dim" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/san-pham/${item.productId}`}
                      className="line-clamp-1 text-title-sm text-on-surface hover:text-primary"
                    >
                      {item.name}
                    </Link>
                    <div className="flex justify-between text-body-sm">
                      <span className="text-on-surface-variant">
                        SL: {formatNumber(item.quantity)}
                      </span>
                      <span className="font-semibold text-on-surface">
                        {formatPrice(item.lineTotal)}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex items-end justify-between rounded-lg bg-surface-container-low p-space-md">
              <span className="text-title-md text-on-surface">Tổng thanh toán</span>
              <span className="text-price-lg text-secondary-container" data-testid="order-total">
                {formatPrice(order.totalAmount)}
              </span>
            </div>
          </Card>

          <Card className="space-y-space-md p-space-lg">
            <h2 className="flex items-center gap-space-sm text-headline-sm text-on-surface">
              <Icon name="support_agent" className="text-primary" />
              Cần hỗ trợ đơn hàng?
            </h2>
            <p className="text-body-md text-on-surface-variant">
              Gửi yêu cầu cho đội CSKH ShopFast, nhớ kèm mã đơn #{order.code}.
            </p>
            <Link
              to={`/ho-tro?don=${order.id}`}
              className="flex h-10 items-center justify-center gap-space-sm rounded-lg bg-primary-fixed text-title-sm text-primary transition-colors hover:bg-primary-fixed-dim"
            >
              <Icon name="chat" className="text-lg" />
              Liên hệ hỗ trợ
            </Link>
          </Card>
        </aside>
      </div>

      <Card className="flex flex-col gap-space-md p-space-md sm:flex-row sm:items-center sm:justify-end">
        <Link
          to="/don-hang"
          className="inline-flex h-10 items-center justify-center gap-space-sm rounded-lg bg-primary-container px-space-lg text-title-sm text-on-primary transition-colors hover:bg-primary"
        >
          <Icon name="arrow_back" className="text-lg" />
          Quay lại đơn hàng của tôi
        </Link>
      </Card>
    </div>
  );
}
