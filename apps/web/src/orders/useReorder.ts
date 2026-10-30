import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/errors';
import { useToast } from '../components/ui';
import { addToCart, cartKeys } from '../products/product-api';
import type { Order } from './my-orders-api';

/**
 * "Mua lại": thêm lần lượt từng sản phẩm của đơn vào giỏ (đúng số lượng). Món nào lỗi (hết hàng,
 * ngừng bán, vượt 99…) được báo riêng; thêm được ít nhất một món → sang giỏ hàng.
 */
export function useReorder() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);

  const reorder = async (order: Order) => {
    if (pendingOrderId) return;
    setPendingOrderId(order.id);
    const failures: string[] = [];
    let added = 0;
    try {
      for (const item of order.items) {
        try {
          await addToCart(item.productId, item.quantity);
          added += 1;
        } catch (error) {
          failures.push(`${item.name}: ${errorMessage(error)}`);
        }
      }
    } finally {
      setPendingOrderId(null);
    }

    if (added > 0) void queryClient.invalidateQueries({ queryKey: cartKeys.all });
    if (failures.length > 0) {
      toast.show({
        tone: added > 0 ? 'warning' : 'error',
        title:
          added > 0
            ? `Đã thêm ${added}/${order.items.length} sản phẩm vào giỏ`
            : 'Không thêm được sản phẩm nào vào giỏ',
        description: failures.join('\n'),
        duration: 8_000,
      });
    } else {
      toast.success('Đã thêm vào giỏ hàng', `${added} sản phẩm từ đơn ${order.code}`);
    }
    if (added > 0) navigate('/gio-hang');
  };

  return { reorder, pendingOrderId };
}
