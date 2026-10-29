import { HttpStatus } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { AppException } from '../../common/exceptions/app.exception';

/**
 * Nguồn duy nhất cho các bước chuyển trạng thái đơn hợp lệ (ADR-0006).
 *
 *   PENDING_PAYMENT → PAID → PROCESSING → SHIPPING → DELIVERED
 *          └────────────┴───────┴──→ CANCELLED   (đang giao thì không huỷ được)
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  [OrderStatus.PENDING_PAYMENT]: [OrderStatus.PAID, OrderStatus.CANCELLED],
  [OrderStatus.PAID]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
  [OrderStatus.PROCESSING]: [OrderStatus.SHIPPING, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPING]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
};

export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  [OrderStatus.PENDING_PAYMENT]: 'Chờ thanh toán',
  [OrderStatus.PAID]: 'Đã thanh toán',
  [OrderStatus.PROCESSING]: 'Đang xử lý',
  [OrderStatus.SHIPPING]: 'Đang giao',
  [OrderStatus.DELIVERED]: 'Đã giao',
  [OrderStatus.CANCELLED]: 'Đã huỷ',
};

export function allowedNext(from: OrderStatus): readonly OrderStatus[] {
  return ORDER_TRANSITIONS[from];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Ném 409 INVALID_STATUS_TRANSITION (kèm các bước được phép) nếu bước chuyển không hợp lệ. */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (canTransition(from, to)) return;

  const allowed = allowedNext(from);
  const hint =
    allowed.length === 0
      ? `Đơn đã ở trạng thái cuối "${ORDER_STATUS_LABELS[from]}".`
      : `Có thể chuyển sang: ${allowed.map((s) => `"${ORDER_STATUS_LABELS[s]}"`).join(', ')}.`;
  throw new AppException(
    HttpStatus.CONFLICT,
    'INVALID_STATUS_TRANSITION',
    `Không thể chuyển đơn từ "${ORDER_STATUS_LABELS[from]}" sang "${ORDER_STATUS_LABELS[to]}". ${hint}`,
    { from, to, allowed },
  );
}
