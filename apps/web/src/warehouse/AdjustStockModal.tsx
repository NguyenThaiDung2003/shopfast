import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { errorMessage, isApiError } from '../api/errors';
import { Button, Icon, Input, Modal, useToast } from '../components/ui';
import { cn } from '../lib/cn';
import { formatNumber, formatPrice } from '../lib/format';
import { productKeys } from '../products/product-api';
import { validateAdjustment, type AdjustmentResult } from './inventory-filters';
import {
  updateProduct,
  warehouseKeys,
  type InventoryItem,
  type ProductPatch,
} from './warehouse-api';

/**
 * "Điều chỉnh tồn kho": nhập/xuất kho bằng `stockDelta` (cộng/trừ nguyên tử ở DB) và – chỉ
 * ADMIN – sửa giá bán, giá gốc, ảnh. Quyền thật do API kiểm; `canEditPrice` chỉ để ẩn các ô đó.
 */
export function AdjustStockModal({
  item,
  canEditPrice,
  onClose,
}: {
  item: InventoryItem;
  canEditPrice: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState(canEditPrice ? String(item.price) : '');
  const [compareAtPrice, setCompareAtPrice] = useState(
    item.compareAtPrice === null ? '' : String(item.compareAtPrice),
  );
  const [imageUrl, setImageUrl] = useState(item.imageUrl ?? '');
  const [errors, setErrors] = useState<AdjustmentResult['errors']>({});

  const qty = /^\d+$/.test(quantity.trim()) ? Number(quantity.trim()) : 0;
  const preview = direction === 'in' ? item.stock + qty : item.stock - qty;

  const save = useMutation({
    mutationFn: (patch: ProductPatch) => updateProduct(item.id, patch),
    onSuccess: (updated, patch) => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.inventoryAll });
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
      const parts = [
        updated.stock !== item.stock &&
          `tồn ${formatNumber(item.stock)} → ${formatNumber(updated.stock)}`,
        updated.price !== item.price &&
          `giá ${formatPrice(item.price)} → ${formatPrice(updated.price)}`,
        patch.compareAtPrice !== undefined && 'giá gốc',
        patch.imageUrl !== undefined && 'ảnh',
      ].filter(Boolean);
      toast.show({
        tone: 'success',
        title: `Đã cập nhật ${updated.sku}`,
        description: parts.join('; '),
      });
      onClose();
    },
    onError: (err) => {
      if (isApiError(err) && err.code === 'INSUFFICIENT_STOCK') {
        // Tồn kho vừa bị đơn khác trừ: báo ngay dưới ô số lượng và tải lại số mới.
        setErrors({ quantity: err.message });
        void queryClient.invalidateQueries({ queryKey: warehouseKeys.inventoryAll });
        return;
      }
      if (isApiError(err) && err.code === 'INVALID_COMPARE_AT_PRICE') {
        setErrors({ compareAtPrice: err.message });
        return;
      }
      setErrors({ form: errorMessage(err) });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validateAdjustment({
      direction,
      quantity,
      price,
      compareAtPrice,
      imageUrl,
      current: item,
      canEditPrice,
    });
    setErrors(result.errors);
    if (result.patch) save.mutate(result.patch);
  };

  const formId = `adjust-${item.id}`;
  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!save.isPending}
      icon="inventory"
      title="Điều chỉnh tồn kho"
      subtitle={`${item.sku} • ${item.name}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Huỷ bỏ
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            icon="check"
            loading={save.isPending}
          >
            Lưu điều chỉnh
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-space-md">
        <div
          role="radiogroup"
          aria-label="Loại điều chỉnh"
          className="grid grid-cols-2 gap-space-sm"
        >
          {(
            [
              ['in', 'Nhập kho (+)', 'add_box'],
              ['out', 'Xuất kho (−)', 'indeterminate_check_box'],
            ] as const
          ).map(([value, label, icon]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={direction === value}
              onClick={() => {
                setDirection(value);
                setErrors({});
              }}
              className={cn(
                'flex items-center justify-center gap-space-xs rounded-lg border px-space-md py-space-sm text-title-sm transition-colors',
                direction === value
                  ? 'border-primary bg-primary-fixed text-primary'
                  : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low',
              )}
            >
              <Icon name={icon} className="text-lg" />
              {label}
            </button>
          ))}
        </div>

        <Input
          label={direction === 'in' ? 'Số lượng nhập' : 'Số lượng xuất'}
          inputMode="numeric"
          value={quantity}
          onChange={(e) => {
            setQuantity(e.target.value);
            setErrors((prev) => ({ ...prev, quantity: undefined, form: undefined }));
          }}
          error={errors.quantity}
          placeholder="0"
          hint={`Đang tồn ${formatNumber(item.stock)} chiếc`}
        />
        <p className="rounded-lg bg-surface-container-low px-space-md py-space-sm text-body-md text-on-surface">
          Tồn sau điều chỉnh:{' '}
          <strong className={cn(preview < 0 ? 'text-error' : 'text-primary')}>
            {formatNumber(preview)} chiếc
          </strong>
        </p>

        {canEditPrice && (
          <>
            <Input
              label="Giá bán (₫)"
              inputMode="numeric"
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
                setErrors((prev) => ({
                  ...prev,
                  price: undefined,
                  compareAtPrice: undefined,
                  form: undefined,
                }));
              }}
              error={errors.price}
              hint={`Giá hiện tại ${formatPrice(item.price)} – chỉ quản trị viên được sửa`}
            />
            <Input
              label="Giá gốc (₫)"
              inputMode="numeric"
              value={compareAtPrice}
              onChange={(e) => {
                setCompareAtPrice(e.target.value);
                setErrors((prev) => ({ ...prev, compareAtPrice: undefined, form: undefined }));
              }}
              error={errors.compareAtPrice}
              hint="Giá trước giảm, lớn hơn giá bán. Để trống nếu không giảm giá."
            />
            <Input
              label="Đường dẫn ảnh"
              value={imageUrl}
              onChange={(e) => {
                setImageUrl(e.target.value);
                setErrors((prev) => ({ ...prev, imageUrl: undefined, form: undefined }));
              }}
              error={errors.imageUrl}
              placeholder="https://… hoặc /images/…"
              hint="Để trống để xoá ảnh."
            />
          </>
        )}

        {errors.form && (
          <p role="alert" className="text-body-sm text-error">
            {errors.form}
          </p>
        )}
      </form>
    </Modal>
  );
}
