import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/errors';
import {
  clearCart,
  fetchCart,
  removeCartItem,
  updateCartItem,
  type Cart,
  type CartItem,
  type Shortage,
} from '../cart/cart-api';
import { CartLineItem } from '../cart/CartLineItem';
import { Breadcrumb } from '../components/Breadcrumb';
import { CheckoutSteps } from '../components/CheckoutSteps';
import { Badge, Button, Card, EmptyState, Icon, Modal, useToast } from '../components/ui';
import { cn } from '../lib/cn';
import { formatNumber, formatPrice } from '../lib/format';
import { cartKeys } from '../products/product-api';

interface RowState {
  pending?: boolean;
  error?: string;
}

const EMPTY_CART: Cart = { items: [], totalQuantity: 0, subtotal: 0 };

function CartSkeleton() {
  const bar = 'rounded bg-surface-container-high';
  return (
    <div
      role="status"
      aria-label="Đang tải giỏ hàng"
      className="grid animate-pulse gap-space-lg lg:grid-cols-12"
    >
      <div className="space-y-space-md lg:col-span-8">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="flex items-center gap-space-md">
            <div className="h-20 w-20 rounded-lg bg-surface-container-low" />
            <div className="flex-1 space-y-space-sm">
              <div className={cn(bar, 'h-4 w-2/3')} />
              <div className={cn(bar, 'h-4 w-1/3')} />
            </div>
          </Card>
        ))}
      </div>
      <Card className="h-64 lg:col-span-4" />
    </div>
  );
}

/** Trang "Giỏ hàng" (thiết kế apps/web/design/gio-hang): sửa giỏ rồi sang bước thanh toán. */
export function CartPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const location = useLocation();
  const cartQuery = useQuery({
    queryKey: cartKeys.all,
    queryFn: ({ signal }) => fetchCart(signal),
  });

  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [draftErrors, setDraftErrors] = useState<Record<number, boolean>>({});
  // Quay lại từ trang thanh toán sau 409 OUT_OF_STOCK: hiện thiếu hàng theo từng dòng.
  const [shortages, setShortages] = useState<Shortage[]>(
    () => (location.state as { shortages?: Shortage[] } | null)?.shortages ?? [],
  );
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const setRow = (productId: number, state: RowState) =>
    setRows((prev) => ({ ...prev, [productId]: state }));

  /** Giỏ đổi → bỏ cảnh báo thiếu hàng cũ của dòng đó. */
  const afterCartChange = (productId: number) => {
    setShortages((prev) => prev.filter((s) => s.productId !== productId));
  };

  const changeQuantity = async (item: CartItem, quantity: number) => {
    setRow(item.productId, { pending: true });
    try {
      const cart = await updateCartItem(item.productId, quantity);
      queryClient.setQueryData(cartKeys.all, cart);
      setRow(item.productId, {});
      afterCartChange(item.productId);
    } catch (error) {
      setRow(item.productId, { error: errorMessage(error) });
    }
  };

  const remove = async (item: CartItem) => {
    setRow(item.productId, { pending: true });
    try {
      await removeCartItem(item.productId);
      queryClient.setQueryData<Cart>(cartKeys.all, (old) =>
        old
          ? {
              items: old.items.filter((i) => i.productId !== item.productId),
              totalQuantity: old.totalQuantity - item.quantity,
              subtotal: old.subtotal - item.lineTotal,
            }
          : old,
      );
      void queryClient.invalidateQueries({ queryKey: cartKeys.all });
      setRow(item.productId, {});
      onDraftErrorChange(item.productId, false);
      afterCartChange(item.productId);
      toast.success('Đã xoá khỏi giỏ hàng', item.name);
    } catch (error) {
      setRow(item.productId, { error: errorMessage(error) });
    }
  };

  const clearAll = async () => {
    setClearing(true);
    try {
      await clearCart();
      queryClient.setQueryData(cartKeys.all, EMPTY_CART);
      setShortages([]);
      setConfirmClear(false);
      toast.success('Đã xoá toàn bộ giỏ hàng');
    } catch (error) {
      toast.error('Không xoá được giỏ hàng', errorMessage(error));
    } finally {
      setClearing(false);
    }
  };

  const onDraftErrorChange = useCallback((productId: number, hasError: boolean) => {
    setDraftErrors((prev) =>
      prev[productId] === hasError ? prev : { ...prev, [productId]: hasError },
    );
  }, []);

  if (cartQuery.isPending) return <CartSkeleton />;

  if (cartQuery.isError) {
    return (
      <Card>
        <EmptyState
          icon="cloud_off"
          title="Không tải được giỏ hàng"
          description={errorMessage(cartQuery.error)}
          action={
            <Button
              variant="brand"
              icon="refresh"
              loading={cartQuery.isFetching}
              onClick={() => void cartQuery.refetch()}
            >
              Thử lại
            </Button>
          }
        />
      </Card>
    );
  }

  const cart = cartQuery.data;
  if (cart.items.length === 0) {
    return (
      <div className="space-y-space-lg">
        <Breadcrumb items={[{ label: 'Giỏ hàng của bạn' }]} />
        <Card>
          <EmptyState
            icon="shopping_cart"
            title="Giỏ hàng đang trống"
            description="Hãy chọn vài sản phẩm bạn thích rồi quay lại đây để đặt hàng."
            action={
              <Link
                to="/san-pham"
                className="inline-flex h-10 items-center gap-space-sm rounded-lg bg-secondary-container px-space-lg text-title-sm text-on-secondary transition-colors hover:bg-secondary"
              >
                <Icon name="storefront" className="text-lg" />
                Tiếp tục mua sắm
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const shortageById = new Map(shortages.map((s) => [s.productId, s]));
  const shortCount = cart.items.filter(
    (i) => i.insufficientStock || shortageById.has(i.productId),
  ).length;
  const busy = Object.values(rows).some((r) => r.pending) || clearing;
  const blockReason =
    shortCount > 0
      ? 'Có sản phẩm không đủ hàng, vui lòng cập nhật số lượng trước khi đặt.'
      : Object.values(draftErrors).some(Boolean)
        ? 'Vui lòng sửa số lượng không hợp lệ.'
        : busy
          ? 'Đang cập nhật giỏ hàng…'
          : undefined;

  const orderButton = (
    <Button
      size="lg"
      fullWidth
      iconRight="arrow_forward"
      disabled={Boolean(blockReason)}
      onClick={() => navigate('/thanh-toan')}
    >
      Tiến hành đặt hàng
    </Button>
  );

  return (
    <div className="space-y-space-lg pb-28 lg:pb-0">
      <Breadcrumb items={[{ label: 'Giỏ hàng của bạn' }]} />
      <Card>
        <CheckoutSteps current={1} />
      </Card>
      <h1 className="flex flex-wrap items-baseline gap-space-sm text-headline-lg-mobile text-on-surface md:text-display-hero">
        Giỏ hàng
        <span className="text-body-lg font-normal text-on-surface-variant">
          ({formatNumber(cart.items.length)} sản phẩm)
        </span>
      </h1>

      <div className="grid items-start gap-space-lg lg:grid-cols-12">
        <section className="space-y-space-md lg:col-span-8" aria-label="Sản phẩm trong giỏ">
          {shortCount > 0 && (
            <div
              role="alert"
              className="flex items-start gap-space-sm rounded-lg border border-error/30 bg-error-container/60 px-space-lg py-space-md text-body-md text-on-error-container"
            >
              <Icon name="inventory" className="text-xl" />
              <span>
                <strong>{shortCount} sản phẩm không đủ hàng.</strong> Vui lòng cập nhật số lượng
                hoặc xoá sản phẩm rồi đặt hàng lại.
              </span>
            </div>
          )}

          <Card className="hidden grid-cols-[minmax(0,1fr)_120px_150px_140px_40px] items-center gap-space-md px-space-lg py-space-md text-title-sm text-on-surface-variant md:grid">
            <span className="text-title-md text-on-surface">
              Sản phẩm ({formatNumber(cart.items.length)})
            </span>
            <span className="text-center">Đơn giá</span>
            <span className="text-center">Số lượng</span>
            <span className="text-right">Số tiền</span>
            <span />
          </Card>

          {cart.items.map((item) => (
            <CartLineItem
              key={item.productId}
              item={item}
              shortage={shortageById.get(item.productId)}
              pending={Boolean(rows[item.productId]?.pending) || clearing}
              serverError={rows[item.productId]?.error}
              onChangeQuantity={(quantity) => void changeQuantity(item, quantity)}
              onRemove={() => void remove(item)}
              onDraftErrorChange={(hasError) => onDraftErrorChange(item.productId, hasError)}
            />
          ))}

          <div className="flex flex-wrap items-center justify-between gap-space-md pt-space-sm">
            <Link
              to="/san-pham"
              className="flex items-center gap-space-xs text-title-sm text-primary hover:underline"
            >
              <Icon name="arrow_back" className="text-lg" />
              Tiếp tục mua sắm
            </Link>
            <Button
              variant="ghost"
              size="sm"
              icon="delete_sweep"
              disabled={busy}
              onClick={() => setConfirmClear(true)}
            >
              Xoá tất cả
            </Button>
          </div>
        </section>

        <aside className="lg:sticky lg:top-32 lg:col-span-4" aria-label="Tóm tắt đơn hàng">
          <Card className="space-y-space-lg p-space-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-headline-sm text-on-surface">Tóm tắt đơn hàng</h2>
              <Badge>{formatNumber(cart.totalQuantity)} món</Badge>
            </div>
            <dl className="space-y-space-sm text-body-lg">
              <div className="flex justify-between">
                <dt className="text-on-surface-variant">Tạm tính</dt>
                <dd className="font-semibold text-on-surface">{formatPrice(cart.subtotal)}</dd>
              </div>
              <div className="flex items-end justify-between border-t border-surface-container-high pt-space-md">
                <dt className="text-title-md text-on-surface">Tổng cộng</dt>
                <dd className="text-price-lg text-secondary-container" data-testid="order-total">
                  {formatPrice(cart.subtotal)}
                </dd>
              </div>
            </dl>
            <p className="text-body-sm text-on-surface-variant">
              Giá được chốt tại thời điểm đặt hàng.
            </p>
            {orderButton}
            {blockReason && (
              <p className="flex items-start gap-space-xs text-body-sm text-error" role="status">
                <Icon name="info" className="text-base" />
                {blockReason}
              </p>
            )}
          </Card>
        </aside>
      </div>

      {/* Thanh đặt hàng cố định đáy trên mobile (DESIGN.md: sticky action, level 3). */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-space-md bg-surface-container-lowest px-margin-mobile py-space-md shadow-float lg:hidden">
        <div className="min-w-0 flex-1">
          <p className="text-body-sm text-on-surface-variant">Tổng cộng</p>
          <p className="text-price-md text-secondary-container">{formatPrice(cart.subtotal)}</p>
        </div>
        <Button
          disabled={Boolean(blockReason)}
          onClick={() => navigate('/thanh-toan')}
          aria-label="Đặt hàng (thanh dưới)"
        >
          Đặt hàng
        </Button>
      </div>

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        dismissible={!clearing}
        title="Xoá toàn bộ giỏ hàng?"
        icon="delete_sweep"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmClear(false)} disabled={clearing}>
              Huỷ bỏ
            </Button>
            <Button variant="danger" loading={clearing} onClick={() => void clearAll()}>
              Xoá tất cả
            </Button>
          </>
        }
      >
        Toàn bộ {formatNumber(cart.items.length)} sản phẩm sẽ bị xoá khỏi giỏ. Bạn không thể hoàn
        tác thao tác này.
      </Modal>
    </div>
  );
}
