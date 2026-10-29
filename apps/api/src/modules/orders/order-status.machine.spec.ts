import { OrderStatus } from '@prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import {
  allowedNext,
  assertTransition,
  canTransition,
  ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS,
} from './order-status.machine';

const { PENDING_PAYMENT, PAID, PROCESSING, SHIPPING, DELIVERED, CANCELLED } = OrderStatus;
const ALL = Object.values(OrderStatus);

/** Đặc tả nghiệp vụ, viết độc lập với bảng ORDER_TRANSITIONS để phát hiện sửa nhầm. */
const VALID: Array<[OrderStatus, OrderStatus]> = [
  [PENDING_PAYMENT, PAID],
  [PAID, PROCESSING],
  [PROCESSING, SHIPPING],
  [SHIPPING, DELIVERED],
  [PENDING_PAYMENT, CANCELLED],
  [PAID, CANCELLED],
  [PROCESSING, CANCELLED],
];
const isValid = (from: OrderStatus, to: OrderStatus) =>
  VALID.some(([f, t]) => f === from && t === to);

const ALL_PAIRS = ALL.flatMap((from) => ALL.map((to) => [from, to] as [OrderStatus, OrderStatus]));

describe('order status state machine', () => {
  it('bảng chuyển có đủ 6 trạng thái và đúng 7 bước hợp lệ', () => {
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...ALL].sort());
    expect(Object.values(ORDER_TRANSITIONS).flat()).toHaveLength(VALID.length);
  });

  describe.each(ALL_PAIRS)('%s → %s', (from, to) => {
    if (isValid(from, to)) {
      it('hợp lệ', () => {
        expect(canTransition(from, to)).toBe(true);
        expect(() => assertTransition(from, to)).not.toThrow();
      });
    } else {
      it('bị từ chối với 409 INVALID_STATUS_TRANSITION', () => {
        expect(canTransition(from, to)).toBe(false);
        expect(() => assertTransition(from, to)).toThrow(
          expect.objectContaining({
            code: 'INVALID_STATUS_TRANSITION',
            details: { from, to, allowed: allowedNext(from) },
          }),
        );
      });
    }
  });

  it('luồng chính đi được từ đầu tới cuối', () => {
    const path = [PENDING_PAYMENT, PAID, PROCESSING, SHIPPING, DELIVERED];
    for (let i = 1; i < path.length; i++) {
      expect(canTransition(path[i - 1]!, path[i]!)).toBe(true);
    }
  });

  it('không được nhảy cóc', () => {
    expect(canTransition(PENDING_PAYMENT, PROCESSING)).toBe(false);
    expect(canTransition(PENDING_PAYMENT, DELIVERED)).toBe(false);
    expect(canTransition(PAID, SHIPPING)).toBe(false);
  });

  it('không được lùi trạng thái', () => {
    expect(canTransition(SHIPPING, PROCESSING)).toBe(false);
    expect(canTransition(PAID, PENDING_PAYMENT)).toBe(false);
  });

  it('giữ nguyên trạng thái không phải là một bước chuyển', () => {
    for (const status of ALL) expect(canTransition(status, status)).toBe(false);
  });

  it('đang giao thì không huỷ được', () => {
    expect(canTransition(SHIPPING, CANCELLED)).toBe(false);
  });

  it.each([DELIVERED, CANCELLED])('%s là trạng thái cuối', (status) => {
    expect(allowedNext(status)).toEqual([]);
  });

  it('thông điệp tiếng Việt nêu các bước được phép', () => {
    try {
      assertTransition(PAID, DELIVERED);
      fail('phải ném lỗi');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).getStatus()).toBe(409);
      expect((error as AppException).userMessage).toBe(
        'Không thể chuyển đơn từ "Đã thanh toán" sang "Đã giao". Có thể chuyển sang: "Đang xử lý", "Đã huỷ".',
      );
    }
  });

  it('thông điệp cho trạng thái cuối', () => {
    expect(() => assertTransition(CANCELLED, PAID)).toThrow(
      expect.objectContaining({
        userMessage:
          'Không thể chuyển đơn từ "Đã huỷ" sang "Đã thanh toán". Đơn đã ở trạng thái cuối "Đã huỷ".',
      }),
    );
  });

  it('mọi trạng thái đều có nhãn tiếng Việt', () => {
    for (const status of ALL) expect(ORDER_STATUS_LABELS[status]).toEqual(expect.any(String));
  });
});
