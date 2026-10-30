import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/errors';
import { useMe } from '../auth/useAuth';
import { fetchCart, readShortages, type Cart, type Shortage } from '../cart/cart-api';
import {
  EMPTY_CHECKOUT_FORM,
  MAX_NOTE_LENGTH,
  toShippingInfo,
  validateCheckout,
  type CheckoutErrors,
  type CheckoutForm,
} from '../cart/checkout-form';
import { usePlaceOrder } from '../cart/usePlaceOrder';
import { CheckoutSteps } from '../components/CheckoutSteps';
import { Badge, Button, Card, EmptyState, Icon, Input, Textarea } from '../components/ui';
import { formatNumber, formatPrice } from '../lib/format';
import { cartKeys } from '../products/product-api';

const EMPTY_CART: Cart = { items: [], totalQuantity: 0, subtotal: 0 };

function SectionTitle({ icon, children }: { icon: string; children: string }) {
  return (
    <h2 className="flex items-center gap-space-sm text-headline-sm text-on-surface">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-fixed text-primary">
        <Icon name={icon} className="text-xl" />
      </span>
      {children}
    </h2>
  );
}

/** Phương thức duy nhất API hỗ trợ: hiện đã chọn sẵn, không cho đổi. */
function FixedOption({
  icon,
  title,
  description,
  trailing,
}: {
  icon: string;
  title: string;
  description: string;
  trailing?: string;
}) {
  return (
    <div className="flex items-center gap-space-md rounded-lg bg-surface-container-low p-space-md ring-2 ring-primary">
      <Icon name={icon} className="text-2xl text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-title-md text-on-surface">{title}</p>
        <p className="text-body-sm text-on-surface-variant">{description}</p>
      </div>
      {trailing && <span className="text-price-md text-tertiary-container">{trailing}</span>}
    </div>
  );
}

/** Trang "Thanh toán và đặt hàng" (thiết kế apps/web/design/thanh-toan-va-dat-hang). */
export function CheckoutPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const me = useMe();
  const cartQuery = useQuery({
    queryKey: cartKeys.all,
    queryFn: ({ signal }) => fetchCart(signal),
  });

  const [form, setForm] = useState<CheckoutForm>(EMPTY_CHECKOUT_FORM);
  const [errors, setErrors] = useState<CheckoutErrors>({});
  const [shortages, setShortages] = useState<Shortage[]>([]);
  const [serverError, setServerError] = useState<string>();
  const formRef = useRef<HTMLFormElement>(null);

  const order = usePlaceOrder({
    onSuccess: (created) => {
      queryClient.setQueryData(cartKeys.all, EMPTY_CART);
      void queryClient.invalidateQueries({ queryKey: cartKeys.all });
      // replace: Back không quay lại form của đơn đã đặt.
      navigate(`/dat-hang-thanh-cong/${created.id}`, { replace: true });
    },
    onError: (error) => {
      const short = readShortages(error);
      if (short.length > 0) {
        setShortages(short);
        setServerError(undefined);
        void cartQuery.refetch();
        return;
      }
      setServerError(errorMessage(error));
    },
  });

  const fullName = me.data?.fullName;
  useEffect(() => {
    if (fullName) {
      setForm((prev) => (prev.recipientName ? prev : { ...prev, recipientName: fullName }));
    }
  }, [fullName]);

  // Sau khi báo lỗi, đưa con trỏ tới ô sai đầu tiên.
  useEffect(() => {
    if (Object.keys(errors).length === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  const edit = (field: keyof CheckoutForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setServerError(undefined);
    order.resetKey(); // Thông tin đổi → lần đặt sau là yêu cầu mới.
  };

  if (cartQuery.isPending) {
    return (
      <div role="status" aria-label="Đang tải đơn hàng" className="animate-pulse space-y-space-lg">
        <div className="h-16 rounded-lg bg-surface-container-low" />
        <div className="grid gap-space-lg lg:grid-cols-12">
          <Card className="h-96 lg:col-span-7" />
          <Card className="h-96 lg:col-span-5" />
        </div>
      </div>
    );
  }

  if (cartQuery.isError) {
    return (
      <Card>
        <EmptyState
          icon="cloud_off"
          title="Không tải được đơn hàng"
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
      <Card>
        <EmptyState
          icon="shopping_cart"
          title="Giỏ hàng đang trống"
          description="Hãy thêm sản phẩm vào giỏ trước khi thanh toán."
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
    );
  }

  const shortageById = new Map(shortages.map((s) => [s.productId, s]));
  const hasShortage = shortages.length > 0 || cart.items.some((i) => i.insufficientStock);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (hasShortage) return;
    const found = validateCheckout(form);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    setServerError(undefined);
    order.submit(toShippingInfo(form));
  };

  const fieldProps = (field: keyof CheckoutForm) => ({
    value: form[field],
    error: errors[field],
    onChange: (e: { target: { value: string } }) => edit(field, e.target.value),
  });

  const total = formatPrice(cart.subtotal);

  return (
    <div className="space-y-space-lg pb-28 lg:pb-0">
      <h1 className="sr-only">Thanh toán và đặt hàng</h1>
      <Card>
        <CheckoutSteps current={2} />
      </Card>

      <div className="grid items-start gap-space-lg lg:grid-cols-12">
        <form
          ref={formRef}
          onSubmit={submit}
          noValidate
          aria-label="Thông tin đặt hàng"
          className="space-y-space-lg lg:col-span-7"
        >
          <Card className="space-y-space-md p-space-lg">
            <SectionTitle icon="location_on">1. Địa chỉ nhận hàng</SectionTitle>
            <div className="grid gap-space-md sm:grid-cols-2">
              <Input
                label="Họ và tên người nhận"
                required
                icon="person"
                autoComplete="name"
                {...fieldProps('recipientName')}
              />
              <Input
                label="Số điện thoại liên lạc"
                required
                icon="call"
                inputMode="tel"
                autoComplete="tel"
                {...fieldProps('phone')}
              />
              <Input
                label="Tỉnh / Thành phố"
                required
                icon="apartment"
                autoComplete="address-level1"
                {...fieldProps('province')}
              />
              <Input
                label="Quận / Huyện & Phường / Xã"
                required
                icon="map"
                autoComplete="address-level2"
                {...fieldProps('district')}
              />
            </div>
            <Input
              label="Địa chỉ chi tiết (Toà nhà, số nhà, ngõ ngách)"
              required
              icon="home_pin"
              autoComplete="street-address"
              {...fieldProps('street')}
            />
            <Textarea
              label="Ghi chú đơn hàng (tuỳ chọn)"
              rows={3}
              counterMax={MAX_NOTE_LENGTH}
              placeholder="Ví dụ: giao giờ hành chính, gọi trước khi đến"
              {...fieldProps('note')}
            />
          </Card>

          <Card className="space-y-space-md p-space-lg">
            <SectionTitle icon="local_shipping">2. Phương thức vận chuyển</SectionTitle>
            <FixedOption
              icon="local_shipping"
              title="Giao hàng tiêu chuẩn"
              description="Do ShopFast giao tới địa chỉ của bạn"
              trailing="Miễn phí"
            />
          </Card>

          <Card className="space-y-space-md p-space-lg">
            <SectionTitle icon="payments">3. Phương thức thanh toán</SectionTitle>
            <FixedOption
              icon="payments"
              title="Thanh toán khi nhận hàng (COD)"
              description="Thanh toán tiền mặt khi nhận kiện hàng"
            />
          </Card>
        </form>

        <aside
          className="space-y-space-md lg:sticky lg:top-32 lg:col-span-5"
          aria-label="Tóm tắt đơn hàng"
        >
          <Card className="space-y-space-lg p-space-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-headline-sm text-on-surface">Tóm tắt đơn hàng</h2>
              <Badge tone="primary" pill>
                {formatNumber(cart.items.length)} sản phẩm
              </Badge>
            </div>

            <ul className="space-y-space-md">
              {cart.items.map((item) => {
                const short = shortageById.get(item.productId);
                const available = short?.available ?? item.available;
                const isShort = Boolean(short) || item.insufficientStock;
                return (
                  <li key={item.productId} className="flex gap-space-md">
                    <span className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-surface-container-low text-on-surface-variant">
                      <Icon name="inventory_2" className="text-2xl" />
                      <span className="absolute right-0 top-0 rounded-bl bg-primary-container px-space-xs text-label-sm text-on-primary">
                        x{item.quantity}
                      </span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-title-sm text-on-surface">{item.name}</p>
                      <p className="text-body-sm text-on-surface-variant">{item.sku}</p>
                      <p className="text-price-sm text-on-surface">{formatPrice(item.lineTotal)}</p>
                      {isShort && (
                        <p className="mt-space-xs flex items-start gap-space-xs text-body-sm text-error">
                          <Icon name="inventory" className="text-base" />
                          {available === 0
                            ? `Đã hết hàng, bạn đặt ${formatNumber(short?.requested ?? item.quantity)}.`
                            : `Chỉ còn ${formatNumber(available)}, bạn đặt ${formatNumber(short?.requested ?? item.quantity)}.`}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            <dl className="space-y-space-sm border-t border-surface-container-high pt-space-md text-body-lg">
              <div className="flex justify-between">
                <dt className="text-on-surface-variant">Tạm tính hàng hoá:</dt>
                <dd className="font-semibold text-on-surface">{total}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-on-surface-variant">Phí vận chuyển:</dt>
                <dd className="font-semibold text-tertiary-container">Miễn phí</dd>
              </div>
              <div className="flex items-end justify-between border-t border-surface-container-high pt-space-md">
                <dt className="text-title-md text-on-surface">Tổng thanh toán:</dt>
                <dd className="text-price-lg text-secondary-container" data-testid="order-total">
                  {total}
                </dd>
              </div>
            </dl>

            {hasShortage && (
              <div
                role="alert"
                className="space-y-space-sm rounded-lg bg-error-container/60 px-space-md py-space-sm text-body-md text-on-error-container"
              >
                <p>Có sản phẩm không đủ hàng. Vui lòng cập nhật giỏ hàng trước khi đặt.</p>
                <Link
                  to="/gio-hang"
                  state={{ shortages }}
                  className="inline-flex items-center gap-space-xs text-title-sm underline"
                >
                  <Icon name="arrow_back" className="text-lg" />
                  Cập nhật giỏ hàng
                </Link>
              </div>
            )}
            {serverError && (
              <p
                role="alert"
                className="flex items-start gap-space-sm rounded-lg bg-error-container/60 px-space-md py-space-sm text-body-md text-on-error-container"
              >
                <Icon name="error" className="text-lg" />
                {serverError}
              </p>
            )}

            <Button
              size="lg"
              fullWidth
              icon="lock"
              loading={order.isPending}
              disabled={hasShortage}
              onClick={() => submit()}
            >
              Đặt hàng ({total})
            </Button>
          </Card>

          <Link
            to="/ho-tro"
            className="flex items-center gap-space-md rounded-xl bg-surface-container-lowest p-space-md shadow-card hover:shadow-card-hover"
          >
            <Icon name="support_agent" className="text-2xl text-primary" />
            <span className="text-title-sm text-on-surface">Cần hỗ trợ đặt hàng? Liên hệ CSKH</span>
          </Link>
        </aside>
      </div>

      {/* Thanh đặt hàng cố định đáy trên mobile (DESIGN.md: sticky action, level 3). */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-space-md bg-surface-container-lowest px-margin-mobile py-space-md shadow-float lg:hidden">
        <div className="min-w-0 flex-1">
          <p className="text-body-sm text-on-surface-variant">Tổng thanh toán</p>
          <p className="text-price-md text-secondary-container">{total}</p>
        </div>
        <Button
          loading={order.isPending}
          disabled={hasShortage}
          onClick={() => submit()}
          aria-label="Đặt hàng (thanh dưới)"
        >
          Đặt hàng
        </Button>
      </div>
    </div>
  );
}
