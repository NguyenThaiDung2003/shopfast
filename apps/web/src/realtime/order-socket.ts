import { io, type Socket } from 'socket.io-client';

// Client realtime theo dõi đơn (F02, ADR-0010). Không phụ thuộc React để dùng lại được ở nơi
// khác (e2e test của API chạy chính file này trên Node). Hợp đồng sự kiện khớp với
// apps/api/src/modules/realtime/realtime.events.ts.

export type OrderStatus =
  'PENDING_PAYMENT' | 'PAID' | 'PROCESSING' | 'SHIPPING' | 'DELIVERED' | 'CANCELLED';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface OrderUpdate {
  orderId: string;
  code: string;
  from: OrderStatus;
  to: OrderStatus;
  occurredAt: string;
}

/** Trạng thái hiện tại của đơn, server trả khi subscribe (kể cả sau mỗi lần nối lại). */
export interface OrderSnapshot {
  id: string;
  code: string;
  status: OrderStatus;
}

export interface SocketError {
  code: string;
  message: string;
}

type SubscribeAck = { ok: true; order: OrderSnapshot } | { ok: false; error: SocketError };

export interface OrderSocketOptions {
  /** Gốc server; mặc định cùng origin với trang (đi qua proxy Vite/Nginx). */
  url?: string;
  /** Gọi ở MỖI lần (nối lại) kết nối – trả access token mới nhất (đã refresh nếu cần). */
  getAccessToken: () => string | null | Promise<string | null>;
  ackTimeoutMs?: number;
  /** Chờ tối đa giữa các lần nối lại (ms). */
  maxRetryDelayMs?: number;
}

const ORDER_SUBSCRIBE = 'order:subscribe';
const ORDER_UNSUBSCRIBE = 'order:unsubscribe';
const ORDER_UPDATED = 'order:updated';
/** Lỗi subscribe vĩnh viễn: thử lại không có ích nên bỏ đơn khỏi danh sách theo dõi. */
const PERMANENT_ERRORS = new Set(['ORDER_NOT_FOUND', 'VALIDATION_FAILED']);

type Listener<T extends unknown[]> = (...args: T) => void;

class Emitter<T extends unknown[]> {
  private readonly listeners = new Set<Listener<T>>();

  on(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(...args: T): void {
    this.listeners.forEach((listener) => listener(...args));
  }
}

/**
 * Tự nối lại khi mất mạng và tự subscribe lại mọi đơn đang theo dõi sau mỗi lần nối lại;
 * ack của subscribe mang trạng thái mới nhất nên bù được thay đổi đã lỡ khi mất kết nối.
 */
export class OrderSocketClient {
  private readonly socket: Socket;
  private readonly tracked = new Set<string>();
  private readonly ackTimeoutMs: number;
  private readonly maxRetryDelayMs: number;
  private state: ConnectionState = 'connecting';
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryAttempt = 0;
  private closed = false;

  private readonly updates = new Emitter<[OrderUpdate]>();
  private readonly snapshots = new Emitter<[OrderSnapshot]>();
  private readonly states = new Emitter<[ConnectionState]>();
  private readonly errors = new Emitter<[SocketError, string | undefined]>();

  constructor(options: OrderSocketOptions) {
    this.ackTimeoutMs = options.ackTimeoutMs ?? 5_000;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 30_000;
    const socketOptions = {
      path: '/socket.io',
      // Chỉ websocket: nhiều instance sau load balancer không cần sticky session.
      transports: ['websocket'],
      reconnectionDelay: 500,
      reconnectionDelayMax: this.maxRetryDelayMs,
      auth: (cb: (data: { token: string }) => void) => {
        Promise.resolve()
          .then(options.getAccessToken)
          .then(
            (token) => cb({ token: token ?? '' }),
            () => cb({ token: '' }),
          );
      },
    };
    this.socket = options.url ? io(options.url, socketOptions) : io(socketOptions);

    this.socket.on('connect', () => {
      this.retryAttempt = 0;
      this.setState('connected');
      this.tracked.forEach((orderId) => this.subscribe(orderId));
    });

    this.socket.on('disconnect', (reason) => {
      if (this.closed) return;
      this.setState('reconnecting');
      // Server chủ động ngắt (token hết hạn, instance tắt khi deploy): Socket.IO không tự nối
      // lại trong trường hợp này. Mất mạng thông thường thì Socket.IO tự nối lại.
      if (reason === 'io server disconnect') this.scheduleRetry();
    });

    this.socket.on('connect_error', (error: Error & { data?: SocketError }) => {
      if (this.closed) return;
      if (error.data?.code) this.errors.emit(error.data, undefined);
      this.setState('reconnecting');
      // Server từ chối handshake (token sai/hết hạn) → socket không còn "active", phải tự hẹn
      // nối lại; getAccessToken sẽ được gọi lại để lấy token mới.
      if (!this.socket.active) this.scheduleRetry();
    });

    this.socket.on(ORDER_UPDATED, (update: OrderUpdate) => {
      if (this.tracked.has(update.orderId)) this.updates.emit(update);
    });
  }

  get connection(): ConnectionState {
    return this.state;
  }

  get trackedOrderIds(): string[] {
    return [...this.tracked];
  }

  track(orderId: string): void {
    if (this.tracked.has(orderId)) return;
    this.tracked.add(orderId);
    if (this.socket.connected) this.subscribe(orderId);
  }

  untrack(orderId: string): void {
    if (!this.tracked.delete(orderId)) return;
    if (this.socket.connected) this.socket.emit(ORDER_UNSUBSCRIBE, { orderId });
  }

  onUpdate(listener: Listener<[OrderUpdate]>): () => void {
    return this.updates.on(listener);
  }

  onSnapshot(listener: Listener<[OrderSnapshot]>): () => void {
    return this.snapshots.on(listener);
  }

  onStateChange(listener: Listener<[ConnectionState]>): () => void {
    return this.states.on(listener);
  }

  /** `orderId` có khi lỗi thuộc về một lần subscribe; không có khi là lỗi kết nối/xác thực. */
  onError(listener: Listener<[SocketError, string | undefined]>): () => void {
    return this.errors.on(listener);
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retryTimer);
    this.socket.disconnect();
    this.setState('disconnected');
  }

  private subscribe(orderId: string): void {
    this.socket
      .timeout(this.ackTimeoutMs)
      .emit(ORDER_SUBSCRIBE, { orderId }, (timeoutError: Error | null, ack?: SubscribeAck) => {
        // Hết thời gian chờ ack: lần nối lại kế tiếp sẽ subscribe lại.
        if (timeoutError || !ack || !this.tracked.has(orderId)) return;
        if (ack.ok) {
          this.snapshots.emit(ack.order);
          return;
        }
        if (PERMANENT_ERRORS.has(ack.error.code)) this.tracked.delete(orderId);
        this.errors.emit(ack.error, orderId);
      });
  }

  private scheduleRetry(): void {
    clearTimeout(this.retryTimer);
    const delay = Math.min(500 * 2 ** this.retryAttempt, this.maxRetryDelayMs);
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      if (!this.closed && !this.socket.connected) this.socket.connect();
    }, delay);
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.states.emit(state);
  }
}
