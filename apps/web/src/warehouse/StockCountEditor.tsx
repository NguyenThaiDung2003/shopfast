import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { errorMessage, isApiError } from '../api/errors';
import { Button, QuantityInput, useToast } from '../components/ui';
import { formatNumber } from '../lib/format';
import { MAX_STOCK, validateStockCount } from './inventory-filters';
import { updateProduct, warehouseKeys, type InventoryItem } from './warehouse-api';

/**
 * Kiểm kê tại dòng: đặt lại số tồn tuyệt đối (`PATCH { stock, expectedStock }`). Có đơn trừ
 * kho trong lúc đang đếm thì API trả 409 STOCK_CHANGED thay vì ghi đè.
 */
export function StockCountEditor({ item, onDone }: { item: InventoryItem; onDone: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(String(item.stock));
  const [error, setError] = useState<string>();

  const save = useMutation({
    mutationFn: (stock: number) => updateProduct(item.id, { stock, expectedStock: item.stock }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.inventoryAll });
      toast.show({
        tone: 'success',
        title: `Đã cập nhật tồn kho ${updated.sku}`,
        description: `${formatNumber(item.stock)} → ${formatNumber(updated.stock)} chiếc.`,
      });
      onDone();
    },
    onError: (err) => {
      setError(errorMessage(err));
      // Tồn vừa bị đơn khác đổi: tải số mới, nhân viên kiểm lại rồi bấm Lưu lần nữa.
      if (isApiError(err) && err.code === 'STOCK_CHANGED') {
        void queryClient.invalidateQueries({ queryKey: warehouseKeys.inventoryAll });
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validateStockCount(value);
    setError(result.error);
    if (result.value === undefined) return;
    if (result.value === item.stock) {
      onDone();
      return;
    }
    save.mutate(result.value);
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={`Kiểm kê ${item.sku}`}
      className="flex flex-col gap-space-xs"
    >
      <div className="flex items-start gap-space-sm">
        <QuantityInput
          compact
          value={value}
          onChange={(next) => {
            setValue(next);
            setError(undefined);
          }}
          min={0}
          max={MAX_STOCK}
          label={`Số tồn thực tế ${item.sku}`}
          error={error}
          className="w-36"
        />
        <Button type="submit" size="sm" variant="brand" icon="save" loading={save.isPending}>
          Lưu
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={save.isPending}>
          Huỷ
        </Button>
      </div>
      <p className="text-label-sm text-on-surface-variant">
        Đặt lại số tồn tuyệt đối theo kết quả kiểm kê.
      </p>
    </form>
  );
}
