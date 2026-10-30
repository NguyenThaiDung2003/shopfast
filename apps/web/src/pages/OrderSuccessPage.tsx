import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { errorMessage, isApiError } from '../api/errors';
import { CheckoutSteps } from '../components/CheckoutSteps';
import { Badge, Button, Card, EmptyState, Icon, useToast } from '../components/ui';
import { formatDayTime, formatNumber, formatPrice } from '../lib/format';
import { isUuid } from '../lib/uuid';
import { fetchOrder, orderKeys } from '../orders/my-orders-api';

const linkClass =
  'flex h-12 items-center justify-center gap-space-sm rounded-lg text-title-sm transition-colors';

function NotFound() {
  return (
    <Card>
      <EmptyState
        icon="search_off"
        title="Không tìm thấy đơn hàng"
        description="Đơn không tồn tại hoặc không thuộc tài khoản của bạn."
        action={
          <Link to="/don-hang" className="text-title-sm text-primary hover:underline">
            Xem đơn hàng của tôi
          </Link>
        }
      />
    </Card>
  );
}

/** Trang "Đặt hàng thành công" (thiết kế apps/web/design/xac-nhan-don-hang-thanh-cong). */
export function OrderSuccessPage() {
  const { id } = useParams();
  const toast = useToast();
  const valid = isUuid(id);
  const query = useQuery({
    queryKey: orderKeys.detail(id ?? ''),
    queryFn: ({ signal }) => fetchOrder(id!, signal),
    enabled: valid,
  });

  if (!valid) return <NotFound />;
  if (query.isPending) {
    return (
      <div role="status" aria-label="Đang tải đơn hàng" className="animate-pulse space-y-space-lg">
        <Card className="h-24" />
        <Card className="h-64" />
      </div>
    );
  }
  if (query.isError) {
    if (isApiError(query.error) && [400, 404].includes(query.error.status)) return <NotFound />;
    return (
      <Card>
        <EmptyState
          icon="cloud_off"
          title="Không tải được đơn hàng"
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

  const order = query.data;
  const shipping = order.shipping;
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);

  const copyCode = () => {
    void navigator.clipboard?.writeText(order.code).then(
      () => toast.success('Đã sao chép mã đơn hàng', order.code),
      () => undefined,
    );
  };

  return (
    <div className="space-y-space-lg">
      <Card>
        <CheckoutSteps current={3} done />
      </Card>

      <div className="grid items-start gap-space-lg lg:grid-cols-12">
        <div className="space-y-space-lg lg:col-span-8">
          <Card className="flex flex-col items-center gap-space-md p-space-xl text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-xl bg-tertiary-container text-on-primary">
              <Icon name="check_circle" className="text-5xl" />
            </span>
            <h1 className="text-headline-lg-mobile text-on-surface md:text-headline-lg">
              Đặt hàng thành công!
            </h1>
            <p className="max-w-xl text-body-lg text-on-surface-variant">
              Cảm ơn bạn{shipping && <strong> {shipping.recipientName}</strong>} đã mua sắm tại
              ShopFast. Đơn hàng của bạn đã được tiếp nhận.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-space-md rounded-lg bg-surface-container-low px-space-lg py-space-md">
              <span className="text-body-lg text-on-surface-variant">Mã đơn hàng:</span>
              <strong className="text-headline-sm text-primary">#{order.code}</strong>
              <Button size="sm" variant="outline" icon="content_copy" onClick={copyCode}>
                Sao chép
              </Button>
            </div>
          </Card>

          <Card className="space-y-space-md p-space-lg">
            <h2 className="flex items-center gap-space-sm text-headline-sm text-on-surface">
              <Icon name="local_shipping" className="text-primary" />
              Thông tin nhận hàng
            </h2>
            <div className="grid gap-space-md md:grid-cols-2">
              {shipping && (
                <section
                  aria-label="Người nhận hàng"
                  className="space-y-space-xs rounded-lg bg-surface-container-low p-space-md"
                >
                  <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                    Người nhận hàng
                  </p>
                  <p className="text-title-md text-on-surface">
                    {shipping.recipientName} ({shipping.phone})
                  </p>
                  <p className="break-words text-body-md text-on-surface-variant">
                    {shipping.address}
                  </p>
                  {shipping.note && (
                    <p className="break-words text-body-sm text-on-surface-variant">
                      Ghi chú: {shipping.note}
                    </p>
                  )}
                </section>
              )}
              <section
                aria-label="Hình thức thanh toán"
                className="space-y-space-xs rounded-lg bg-surface-container-low p-space-md"
              >
                <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                  Hình thức thanh toán
                </p>
                <p className="text-title-md text-on-surface">Thanh toán khi nhận hàng (COD)</p>
                <p className="text-body-sm text-on-surface-variant">
                  Thời gian đặt hàng: {formatDayTime(order.createdAt)}
                </p>
              </section>
            </div>
          </Card>

          <Card className="space-y-space-md p-space-lg">
            <h2 className="flex items-center gap-space-sm text-headline-sm text-on-surface">
              <Icon name="inventory_2" className="text-primary" />
              Sản phẩm đã đặt ({formatNumber(itemCount)} món)
            </h2>
            <ul className="space-y-space-sm">
              {order.items.map((item) => (
                <li
                  key={item.productId}
                  className="flex items-center gap-space-md rounded-lg bg-surface-container-low p-space-md"
                >
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-title-sm text-on-surface">{item.name}</p>
                    <p className="text-body-sm text-on-surface-variant">
                      {item.sku} · SL: {formatNumber(item.quantity)}
                    </p>
                  </div>
                  <span className="shrink-0 text-price-sm text-on-surface">
                    {formatPrice(item.lineTotal)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <aside className="space-y-space-md lg:col-span-4" aria-label="Tổng kết thanh toán">
          <Card className="space-y-space-md p-space-lg">
            <h2 className="text-headline-sm text-on-surface">Tổng kết thanh toán</h2>
            <dl className="space-y-space-sm text-body-md">
              <div className="flex justify-between">
                <dt className="text-on-surface-variant">
                  Tổng tiền hàng ({formatNumber(itemCount)} món):
                </dt>
                <dd className="font-semibold text-on-surface">{formatPrice(order.totalAmount)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-on-surface-variant">Phí vận chuyển:</dt>
                <dd className="font-semibold text-tertiary-container">Miễn phí</dd>
              </div>
              <div className="flex items-end justify-between border-t border-surface-container-high pt-space-md">
                <dt className="text-title-md text-on-surface">Tổng thanh toán COD:</dt>
                <dd className="text-price-lg text-secondary-container" data-testid="order-total">
                  {formatPrice(order.totalAmount)}
                </dd>
              </div>
            </dl>
            <Badge tone="warning" pill>
              Thanh toán khi nhận hàng
            </Badge>
          </Card>

          <Card className="space-y-space-sm p-space-lg">
            <Link
              to={`/don-hang/${order.id}`}
              className={`${linkClass} bg-secondary-container text-on-secondary hover:bg-secondary`}
            >
              <Icon name="track_changes" className="text-lg" />
              Theo dõi tiến độ đơn hàng
            </Link>
            <Link
              to="/san-pham"
              className={`${linkClass} bg-primary-fixed text-primary hover:bg-primary-fixed-dim`}
            >
              <Icon name="storefront" className="text-lg" />
              Tiếp tục mua sắm
            </Link>
            <Link
              to={`/ho-tro?don=${order.id}`}
              className={`${linkClass} text-on-surface-variant hover:bg-surface-container-low`}
            >
              <Icon name="support_agent" className="text-lg" />
              Cần hỗ trợ đơn hàng?
            </Link>
          </Card>
        </aside>
      </div>
    </div>
  );
}
