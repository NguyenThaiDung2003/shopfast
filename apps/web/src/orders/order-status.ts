import type { OrderStatus } from '../realtime/order-socket';

export type { OrderStatus };

export interface OrderStatusMeta {
  label: string;
  /** Icon Material Symbols. */
  icon: string;
  /** Class nền + chữ của badge (token Tailwind). */
  className: string;
}

/**
 * Nơi DUY NHẤT ánh xạ trạng thái đơn → nhãn/màu (theo màn "Đơn hàng của tôi" và
 * "Quản lý đơn hàng kho"). Luật chuyển trạng thái nằm ở API (ADR-0006), không ở đây.
 */
export const ORDER_STATUS_META: Record<OrderStatus, OrderStatusMeta> = {
  PENDING_PAYMENT: {
    label: 'Chờ thanh toán',
    icon: 'schedule',
    className: 'bg-error-container text-on-error-container',
  },
  PAID: {
    label: 'Đã thanh toán',
    icon: 'credit_score',
    className: 'bg-primary-fixed text-on-primary-fixed-variant',
  },
  PROCESSING: {
    label: 'Đang xử lý',
    icon: 'progress_activity',
    className: 'bg-secondary-fixed text-on-secondary-fixed',
  },
  SHIPPING: {
    label: 'Đang giao',
    icon: 'local_shipping',
    className: 'bg-surface-container-high text-primary',
  },
  DELIVERED: {
    label: 'Đã giao',
    icon: 'check_circle',
    className: 'bg-tertiary-fixed text-on-tertiary-fixed',
  },
  CANCELLED: {
    label: 'Đã huỷ',
    icon: 'cancel',
    className: 'bg-surface-variant text-on-surface-variant',
  },
};

export const ORDER_STATUSES = Object.keys(ORDER_STATUS_META) as OrderStatus[];
