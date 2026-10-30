// Nút chuyển trạng thái của đơn kho, dựng từ `nextStatuses` mà API trả về. Web không biết luật
// chuyển trạng thái – chỉ đặt nhãn/icon cho từng trạng thái đích.

import type { OrderStatus } from '../orders/order-status';

export interface TransitionAction {
  to: OrderStatus;
  label: string;
  icon: string;
  /** Bước tiến của luồng xử lý (nút chính) hay huỷ đơn (nút phụ, màu cảnh báo). */
  kind: 'forward' | 'cancel';
}

const ACTION: Record<OrderStatus, { label: string; icon: string }> = {
  PENDING_PAYMENT: { label: 'Chuyển về Chờ thanh toán', icon: 'schedule' },
  PAID: { label: 'Xác nhận thanh toán', icon: 'credit_score' },
  PROCESSING: { label: 'Bắt đầu xử lý', icon: 'inventory' },
  SHIPPING: { label: 'Chuyển sang Đang giao', icon: 'local_shipping' },
  DELIVERED: { label: 'Xác nhận đã giao', icon: 'task_alt' },
  CANCELLED: { label: 'Huỷ đơn', icon: 'cancel' },
};

/** Bước tiến trước, huỷ đơn sau; giữ nguyên thứ tự API trả trong mỗi nhóm. */
export function transitionActions(
  nextStatuses: readonly OrderStatus[] | undefined,
): TransitionAction[] {
  const actions = (nextStatuses ?? []).map((to): TransitionAction => ({
    to,
    ...ACTION[to],
    kind: to === 'CANCELLED' ? 'cancel' : 'forward',
  }));
  return [
    ...actions.filter((a) => a.kind === 'forward'),
    ...actions.filter((a) => a.kind === 'cancel'),
  ];
}
