import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, Icon, QuantityInput, Spinner } from '../components/ui';
import { cn } from '../lib/cn';
import { formatNumber, formatPrice } from '../lib/format';
import { LOW_STOCK_THRESHOLD } from '../products/product-display';
import { maxPurchasable, validateQuantity } from '../products/quantity';
import type { CartItem, Shortage } from './cart-api';

export interface CartLineItemProps {
  item: CartItem;
  /** Thiếu hàng do server báo khi đặt (409 OUT_OF_STOCK). */
  shortage?: Shortage;
  /** Đang lưu thay đổi của dòng này. */
  pending: boolean;
  /** Lỗi server khi sửa/xoá dòng này. */
  serverError?: string;
  onChangeQuantity: (quantity: number) => void;
  onRemove: () => void;
  /** Báo cho trang biết ô số lượng đang có giá trị sai (chặn đặt hàng). */
  onDraftErrorChange: (hasError: boolean) => void;
}

function StockBand({
  item,
  shortage,
  pending,
  onChangeQuantity,
  onRemove,
}: Pick<CartLineItemProps, 'item' | 'shortage' | 'pending' | 'onChangeQuantity' | 'onRemove'>) {
  const available = shortage?.available ?? item.available;
  const short = Boolean(shortage) || item.insufficientStock;

  if (short) {
    const canKeep = maxPurchasable(available);
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-space-sm rounded-lg bg-error-container px-space-md py-space-sm text-body-md text-on-error-container"
      >
        <span className="flex items-center gap-space-sm">
          <Icon name="error" className="text-lg" />
          {available === 0
            ? 'Sản phẩm đã hết hàng.'
            : `Chỉ còn ${formatNumber(available)} sản phẩm, bạn đang chọn ${formatNumber(item.quantity)}.`}
        </span>
        {canKeep > 0 ? (
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() => onChangeQuantity(canKeep)}
          >
            Cập nhật về {canKeep}
          </Button>
        ) : (
          <Button size="sm" variant="danger" icon="delete" disabled={pending} onClick={onRemove}>
            Xoá khỏi giỏ
          </Button>
        )}
      </div>
    );
  }

  if (item.available <= LOW_STOCK_THRESHOLD) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-space-sm rounded-lg bg-secondary-fixed/70 px-space-md py-space-sm text-body-md text-on-secondary-fixed">
        <span className="flex items-center gap-space-sm">
          <Icon name="warning" className="text-lg text-secondary" />
          Chỉ còn {formatNumber(item.available)} sản phẩm trong kho! Hãy nhanh tay hoàn tất đơn
          hàng.
        </span>
        <Badge tone="sale" className="uppercase">
          Số lượng có hạn
        </Badge>
      </div>
    );
  }
  return null;
}

/** Một dòng giỏ hàng (thiết kế "Giỏ hàng"): sửa số lượng, xoá, cảnh báo tồn kho theo dòng. */
export function CartLineItem(props: CartLineItemProps) {
  const { item, pending, serverError, onChangeQuantity, onRemove, onDraftErrorChange } = props;
  const [text, setText] = useState(String(item.quantity));

  // Server đổi số lượng (lưu thành công) hoặc từ chối → ô hiện lại giá trị thật.
  useEffect(() => {
    setText(String(item.quantity));
  }, [item.quantity, serverError]);

  const dirty = text.trim() !== String(item.quantity);
  const draftError = dirty ? validateQuantity(text, item.available) : undefined;

  useEffect(() => {
    onDraftErrorChange(Boolean(draftError));
  }, [draftError, onDraftErrorChange]);

  const commit = (value: string) => {
    if (validateQuantity(value, item.available)) return;
    const quantity = Number(value.trim());
    if (quantity !== item.quantity) onChangeQuantity(quantity);
  };

  return (
    <Card className="space-y-space-md p-space-md md:p-space-lg" data-testid="cart-line">
      <StockBand {...props} />
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-space-md md:grid-cols-[auto_minmax(0,1fr)_120px_150px_140px_40px] md:items-center">
        <Link
          to={`/san-pham/${item.productId}`}
          tabIndex={-1}
          aria-hidden
          className="flex h-20 w-20 items-center justify-center rounded-lg bg-surface-container-low md:h-24 md:w-24"
        >
          <Icon name="inventory_2" className="text-4xl text-primary-fixed-dim" />
        </Link>

        <div className="min-w-0 space-y-space-xs">
          <h2 className="line-clamp-2 text-title-md text-on-surface">
            <Link to={`/san-pham/${item.productId}`} className="hover:text-primary">
              {item.name}
            </Link>
          </h2>
          <p className="inline-block rounded bg-surface-container-low px-space-sm py-0.5 text-body-sm text-on-surface-variant">
            SKU: <span className="text-on-surface">{item.sku}</span>
          </p>
          <p className="text-title-sm text-on-surface md:hidden">{formatPrice(item.unitPrice)}</p>
        </div>

        <p className="hidden text-center text-title-md text-on-surface md:block">
          {formatPrice(item.unitPrice)}
        </p>

        <div className="col-span-2 flex items-start justify-between gap-space-md md:contents">
          <div className="md:flex md:justify-center">
            <QuantityInput
              compact
              label={`Số lượng ${item.name}`}
              value={text}
              onChange={setText}
              onCommit={commit}
              max={Math.max(1, maxPurchasable(item.available))}
              disabled={pending}
              error={draftError ?? serverError}
            />
          </div>

          <div className="flex items-center gap-space-sm md:contents">
            <p
              className={cn(
                'text-price-md text-secondary-container md:text-right',
                pending && 'opacity-50',
              )}
              data-testid="line-total"
            >
              {formatPrice(item.lineTotal)}
            </p>
            <button
              type="button"
              onClick={onRemove}
              disabled={pending}
              aria-label={`Xoá ${item.name} khỏi giỏ`}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-error-container hover:text-error disabled:opacity-40"
            >
              {pending ? <Spinner size="sm" label="Đang cập nhật" /> : <Icon name="delete" />}
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}
