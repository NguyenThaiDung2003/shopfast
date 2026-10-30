import { useEffect, useRef, useState } from 'react';
import {
  type ConnectionState,
  OrderSocketClient,
  type OrderStatus,
  type SocketError,
} from './order-socket';

export interface UseOrderTrackingOptions {
  /** Trả access token mới nhất; được gọi lại ở mỗi lần nối lại. */
  getAccessToken: () => string | null | Promise<string | null>;
  url?: string;
}

export interface OrderTrackingState {
  /** Trạng thái mới nhất theo orderId (từ ack subscribe hoặc sự kiện `order:updated`). */
  statuses: Record<string, OrderStatus>;
  connection: ConnectionState;
  /** Lỗi subscribe theo orderId (ví dụ ORDER_NOT_FOUND). */
  errors: Record<string, SocketError>;
  /** Lỗi kết nối/xác thực gần nhất (ví dụ TOKEN_EXPIRED) – nên refresh token. */
  connectionError: SocketError | null;
}

/**
 * Theo dõi trạng thái các đơn theo thời gian thực (F02). Tự nối lại và tự subscribe lại sau
 * khi mất mạng – xem OrderSocketClient.
 *
 * ```tsx
 * const { statuses, connection } = useOrderTracking([orderId], { getAccessToken });
 * ```
 */
export function useOrderTracking(
  orderIds: readonly string[],
  { getAccessToken, url }: UseOrderTrackingOptions,
): OrderTrackingState {
  const tokenRef = useRef(getAccessToken);
  const [client, setClient] = useState<OrderSocketClient | null>(null);
  const [statuses, setStatuses] = useState<Record<string, OrderStatus>>({});
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [errors, setErrors] = useState<Record<string, SocketError>>({});
  const [connectionError, setConnectionError] = useState<SocketError | null>(null);

  useEffect(() => {
    tokenRef.current = getAccessToken;
  }, [getAccessToken]);

  useEffect(() => {
    const socketClient = new OrderSocketClient({ url, getAccessToken: () => tokenRef.current() });
    const unsubscribers = [
      socketClient.onSnapshot((order) =>
        setStatuses((prev) => ({ ...prev, [order.id]: order.status })),
      ),
      socketClient.onUpdate((update) =>
        setStatuses((prev) => ({ ...prev, [update.orderId]: update.to })),
      ),
      socketClient.onStateChange((state) => {
        setConnection(state);
        if (state === 'connected') setConnectionError(null);
      }),
      socketClient.onError((error, orderId) => {
        if (orderId) setErrors((prev) => ({ ...prev, [orderId]: error }));
        else setConnectionError(error);
      }),
    ];
    setClient(socketClient);
    return () => {
      unsubscribers.forEach((off) => off());
      socketClient.close();
      setClient(null);
    };
  }, [url]);

  // Khoá ổn định cho danh sách id để effect không chạy lại khi mảng mới cùng nội dung.
  const idsKey = [...new Set(orderIds)].sort().join(',');
  useEffect(() => {
    if (!client || !idsKey) return;
    const ids = idsKey.split(',');
    ids.forEach((id) => client.track(id));
    return () => ids.forEach((id) => client.untrack(id));
  }, [client, idsKey]);

  return { statuses, connection, errors, connectionError };
}
