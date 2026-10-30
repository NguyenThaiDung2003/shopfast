import { useMutation } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { keepsIdempotencyKey, newIdempotencyKey } from '../lib/idempotency';
import { placeOrder, type Order, type ShippingInfo } from './cart-api';

/**
 * Đặt hàng với Idempotency-Key sinh MỘT lần cho mỗi lần đặt (ADR-0005):
 * - giữ key khi lỗi thử lại được (bấm lại = cùng yêu cầu);
 * - bỏ key khi thành công, lỗi nghiệp vụ dứt khoát (thiếu hàng, giỏ trống…) hoặc form đổi.
 */
export function usePlaceOrder(options: {
  onSuccess: (order: Order) => void;
  onError: (error: unknown) => void;
}) {
  const keyRef = useRef<string | null>(null);

  const mutation = useMutation({
    mutationFn: ({ shipping, key }: { shipping: ShippingInfo; key: string }) =>
      placeOrder(shipping, key),
    onSuccess: (order) => {
      keyRef.current = null;
      options.onSuccess(order);
    },
    onError: (error) => {
      if (!keepsIdempotencyKey(error)) keyRef.current = null;
      options.onError(error);
    },
  });

  const submit = (shipping: ShippingInfo) => {
    if (mutation.isPending) return;
    keyRef.current ??= newIdempotencyKey();
    mutation.mutate({ shipping, key: keyRef.current });
  };

  /** Thông tin đặt hàng vừa đổi → lần đặt sau là yêu cầu mới. */
  const resetKey = useCallback(() => {
    keyRef.current = null;
  }, []);

  return { submit, resetKey, isPending: mutation.isPending };
}
