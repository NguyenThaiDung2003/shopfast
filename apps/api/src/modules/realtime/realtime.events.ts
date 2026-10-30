import type { OrderStatus } from '@prisma/client';

// Hợp đồng sự kiện Socket.IO (F02, ADR-0010). Client mẫu ở apps/web/src/realtime khai báo lại
// cùng hình dạng – đổi ở đây thì đổi cả bên đó.

/** Client → server: `{ orderId }`, ack `SubscribeAck`. */
export const ORDER_SUBSCRIBE = 'order:subscribe';
/** Client → server: `{ orderId }`, ack `{ ok: true }`. */
export const ORDER_UNSUBSCRIBE = 'order:unsubscribe';
/** Server → room `order:<id>`: `OrderUpdatedPayload`. */
export const ORDER_UPDATED = 'order:updated';

const ORDER_ROOM_PREFIX = 'order:';

export function orderRoom(orderId: string): string {
  return `${ORDER_ROOM_PREFIX}${orderId}`;
}

/** Id các đơn mà socket đang theo dõi, suy ra từ danh sách room của nó. */
export function subscribedOrderIds(rooms: Iterable<string>): string[] {
  return [...rooms]
    .filter((room) => room.startsWith(ORDER_ROOM_PREFIX))
    .map((room) => room.slice(ORDER_ROOM_PREFIX.length));
}

/** Không mang `note`/`changedBy`: đó là dữ liệu nội bộ của nhân viên. */
export interface OrderUpdatedPayload {
  orderId: string;
  code: string;
  from: OrderStatus;
  to: OrderStatus;
  /** ISO 8601. */
  occurredAt: string;
}

export interface SocketError {
  code: string;
  /** Thông điệp tiếng Việt cho người dùng. */
  message: string;
}

export type SubscribeAck =
  | { ok: true; order: { id: string; code: string; status: OrderStatus } }
  | { ok: false; error: SocketError };
