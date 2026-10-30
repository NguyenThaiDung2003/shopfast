import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Icon, OrderStatusBadge } from '../components/ui';
import { cn } from '../lib/cn';
import { formatDayTime, formatNumber, formatPrice } from '../lib/format';
import type { Order, OrderItem } from './my-orders-api';

export interface OrderCardProps {
  order: Order;
  reordering: boolean;
  onReorder: (order: Order) => void;
}

const ACTIVE = new Set(['PAID', 'PROCESSING', 'SHIPPING']);
const FINISHED = new Set(['DELIVERED', 'CANCELLED']);

function ItemRow({ item }: { item: OrderItem }) {
  return (
    <li className="flex items-start gap-space-md">
      <Link
        to={`/san-pham/${item.productId}`}
        tabIndex={-1}
        aria-hidden
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-surface-container-low md:h-20 md:w-20"
      >
        <Icon name="inventory_2" className="text-3xl text-primary-fixed-dim" />
      </Link>
      <div className="min-w-0 flex-1 space-y-space-xs">
        <Link
          to={`/san-pham/${item.productId}`}
          className="line-clamp-2 text-title-md text-on-surface hover:text-primary"
        >
          {item.name}
        </Link>
        <p className="text-body-sm text-on-surface-variant">
          SKU: {item.sku} | Số lượng: {formatNumber(item.quantity)}
        </p>
        <p className="text-title-sm text-on-surface">{formatPrice(item.unitPrice)}</p>
      </div>
      <p className="shrink-0 text-title-md text-primary">{formatPrice(item.lineTotal)}</p>
    </li>
  );
}

/** Thẻ đơn (thiết kế "Đơn hàng của tôi"): mã, thời gian, trạng thái, món, tổng tiền, hành động. */
export function OrderCard({ order, reordering, onReorder }: OrderCardProps) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const [first, ...rest] = order.items;
  const pending = order.status === 'PENDING_PAYMENT';

  return (
    <Card flush className="overflow-hidden" data-testid="order-card">
      <header
        className={cn(
          'flex flex-wrap items-center justify-between gap-space-sm px-space-lg py-space-md',
          pending ? 'bg-error-container/40' : 'bg-surface-container-low',
        )}
      >
        <div className="flex flex-wrap items-center gap-x-space-md gap-y-space-xs text-body-sm text-on-surface-variant">
          <h2 className="text-label-md uppercase tracking-wider text-on-surface-variant">
            Mã đơn: <span className="text-title-md normal-case text-primary">#{order.code}</span>
          </h2>
          <span className="flex items-center gap-space-xs">
            <Icon name="schedule" className="text-base" />
            <time dateTime={order.createdAt}>{formatDayTime(order.createdAt)}</time>
          </span>
        </div>
        <OrderStatusBadge status={order.status} />
      </header>

      <div className="space-y-space-md px-space-lg py-space-lg">
        {first && (
          <ul className="space-y-space-md">
            <ItemRow item={first} />
          </ul>
        )}
        {rest.length > 0 && (
          <div className="rounded-lg bg-surface-container-low px-space-md py-space-sm">
            <div className="flex flex-wrap items-center justify-between gap-space-sm">
              <p className="min-w-0 flex-1 truncate text-body-sm text-on-surface-variant">
                <Icon
                  name="layers"
                  className="mr-space-xs align-middle text-base text-secondary-container"
                />
                <strong className="text-on-surface">+ và {rest.length} sản phẩm khác:</strong>{' '}
                {rest.map((i) => i.name).join(', ')}
              </p>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                aria-controls={listId}
                className="flex items-center gap-space-xs text-label-md text-primary hover:underline"
              >
                {expanded ? 'Thu gọn' : 'Xem tất cả'}
                <Icon name={expanded ? 'expand_less' : 'expand_more'} className="text-base" />
              </button>
            </div>
            {expanded && (
              <ul id={listId} className="mt-space-md space-y-space-md">
                {rest.map((item) => (
                  <ItemRow key={item.productId} item={item} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <footer className="flex flex-col gap-space-md border-t border-surface-container-high px-space-lg py-space-md sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-baseline gap-space-sm text-body-lg text-on-surface-variant">
          Tổng thanh toán:
          <span className="text-price-lg text-secondary-container" data-testid="order-total">
            {formatPrice(order.totalAmount)}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-space-sm">
          {ACTIVE.has(order.status) && (
            <Link
              to={`/don-hang/${order.id}`}
              className="inline-flex h-10 items-center gap-space-sm rounded-lg bg-secondary-container px-space-lg text-title-sm text-on-secondary transition-colors hover:bg-secondary"
            >
              <Icon name="local_shipping" className="text-lg" />
              Theo dõi đơn hàng
            </Link>
          )}
          {pending && (
            <Link
              to={`/don-hang/${order.id}`}
              className="inline-flex h-10 items-center rounded-lg bg-primary-fixed px-space-lg text-title-sm text-primary transition-colors hover:bg-primary-fixed-dim"
            >
              Xem chi tiết
            </Link>
          )}
          {FINISHED.has(order.status) && (
            <>
              <Link
                to={`/don-hang/${order.id}`}
                className="inline-flex h-10 items-center rounded-lg px-space-lg text-title-sm text-on-surface-variant transition-colors hover:bg-surface-container-high"
              >
                Xem chi tiết
              </Link>
              <Button
                icon="add_shopping_cart"
                loading={reordering}
                onClick={() => onReorder(order)}
                aria-label={`Mua lại đơn ${order.code}`}
              >
                Mua lại
              </Button>
            </>
          )}
        </div>
      </footer>
    </Card>
  );
}
