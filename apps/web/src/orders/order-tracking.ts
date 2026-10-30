// Logic thuần của trang "Theo dõi đơn hàng": dựng các chặng từ statusHistory + trạng thái realtime.
// Luật chuyển trạng thái nằm ở API (ADR-0006); ở đây chỉ hiển thị.

import { isUuid } from '../lib/uuid';
import type { OrderDetail } from './my-orders-api';
import type { OrderStatus } from './order-status';

/** Thứ tự chặng của đơn bình thường; CANCELLED là nhánh rẽ. */
export const TRACK_STEPS: readonly OrderStatus[] = [
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'SHIPPING',
  'DELIVERED',
];

const STEP_COPY: Record<OrderStatus, { title: string; description: string }> = {
  PENDING_PAYMENT: {
    title: 'Đặt hàng thành công',
    description: 'Đơn hàng đã được ghi nhận và đang chờ thanh toán.',
  },
  PAID: {
    title: 'Đã thanh toán',
    description: 'ShopFast đã nhận thanh toán, đơn được chuyển cho kho xử lý.',
  },
  PROCESSING: {
    title: 'Kho đang xử lý',
    description: 'Kho đang soạn hàng và đóng gói đơn của bạn.',
  },
  SHIPPING: {
    title: 'Đang giao hàng',
    description: 'Đơn đã bàn giao cho đơn vị vận chuyển và đang trên đường tới bạn.',
  },
  DELIVERED: {
    title: 'Đã giao thành công',
    description: 'Đơn hàng đã được giao tới bạn. Cảm ơn bạn đã mua sắm tại ShopFast!',
  },
  CANCELLED: {
    title: 'Đơn đã bị huỷ',
    description: 'Đơn hàng đã bị huỷ; tồn kho đã được hoàn lại.',
  },
};

export type StepState = 'done' | 'current' | 'upcoming' | 'cancelled';

export interface TimelineStep {
  status: OrderStatus;
  title: string;
  description: string;
  state: StepState;
  /** Thời điểm chuyển sang chặng này (ISO); không có = chưa tới hoặc chưa tải lại lịch sử. */
  at?: string;
  /** Ghi chú của nhân viên khi chuyển trạng thái (ví dụ mã vận đơn). */
  note?: string | null;
}

export interface Timeline {
  steps: TimelineStep[];
  /** Chặng hiện tại, bắt đầu từ 1 (0 khi đã huỷ). */
  stepNumber: number;
  totalSteps: number;
  /** % thanh tiến trình. */
  percent: number;
  cancelled: boolean;
}

/**
 * `status` là trạng thái mới nhất (realtime có thể đi trước dữ liệu HTTP); lịch sử lấy từ
 * `order.statusHistory`. Thời điểm của mỗi chặng = lần gần nhất chuyển sang trạng thái đó.
 */
export function buildTimeline(order: OrderDetail, status: OrderStatus): Timeline {
  const at = new Map<OrderStatus, { at: string; note: string | null }>();
  for (const change of order.statusHistory)
    at.set(change.to, { at: change.changedAt, note: change.note });
  if (!at.has('PENDING_PAYMENT')) at.set('PENDING_PAYMENT', { at: order.createdAt, note: null });

  const step = (s: OrderStatus, state: StepState): TimelineStep => ({
    status: s,
    ...STEP_COPY[s],
    state,
    at: state === 'upcoming' ? undefined : at.get(s)?.at,
    note: state === 'upcoming' ? undefined : at.get(s)?.note,
  });

  if (status === 'CANCELLED') {
    // Các chặng đã đi qua trước khi huỷ (lấy từ lịch sử), rồi chặng "Đã huỷ".
    const reached = TRACK_STEPS.filter((s) => at.has(s));
    return {
      steps: [...reached.map((s) => step(s, 'done')), step('CANCELLED', 'cancelled')],
      stepNumber: 0,
      totalSteps: TRACK_STEPS.length,
      percent: 100,
      cancelled: true,
    };
  }

  const current = Math.max(0, TRACK_STEPS.indexOf(status));
  return {
    steps: TRACK_STEPS.map((s, i) =>
      step(s, i < current ? 'done' : i === current ? 'current' : 'upcoming'),
    ),
    stepNumber: current + 1,
    totalSteps: TRACK_STEPS.length,
    percent: Math.round((current / (TRACK_STEPS.length - 1)) * 100),
    cancelled: false,
  };
}

/** Id đơn trên URL phải là UUID (khớp ParseUuidPipe của API) – sai thì không gọi API. */
export function isOrderId(value: string | undefined): value is string {
  return isUuid(value);
}
