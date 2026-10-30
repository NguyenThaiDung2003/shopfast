import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { AuthUser } from '../auth/auth.types';
import { OrderTrackingService, toSocketError } from './order-tracking.service';
import {
  ORDER_SUBSCRIBE,
  ORDER_UNSUBSCRIBE,
  ORDER_UPDATED,
  orderRoom,
  OrderUpdatedPayload,
  SubscribeAck,
  subscribedOrderIds,
} from './realtime.events';

/** Giới hạn của setTimeout (~24,8 ngày); access token ngắn hơn nhiều. */
const MAX_TIMER_MS = 2 ** 31 - 1;

interface SocketData {
  user: AuthUser;
  expiryTimer?: NodeJS.Timeout;
}

type AppSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  SocketData
>;

/** Token lấy từ `auth.token` (client Socket.IO) hoặc header `Authorization: Bearer`. */
function extractToken(socket: Socket): string | undefined {
  const fromAuth = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
  if (typeof fromAuth === 'string' && fromAuth) return fromAuth;
  const [scheme, token] = socket.handshake.headers.authorization?.split(' ') ?? [];
  return scheme === 'Bearer' && token ? token : undefined;
}

/**
 * Kênh realtime theo dõi đơn (F02, ADR-0010) tại `/socket.io`, chỉ transport websocket nên
 * chạy nhiều instance không cần sticky session. Gateway đóng vai controller: không chứa luật
 * nghiệp vụ, mọi quyết định nằm ở OrderTrackingService.
 */
@WebSocketGateway({ transports: ['websocket'] })
export class OrdersGateway implements OnGatewayInit, OnGatewayDisconnect {
  private readonly logger = new Logger(OrdersGateway.name);

  @WebSocketServer()
  private readonly server!: Server;

  constructor(private readonly tracking: OrderTrackingService) {}

  /** Xác thực tại handshake: token sai → `connect_error` với `data = { code, message }`. */
  afterInit(server: Server): void {
    server.use((socket, next) => {
      this.tracking
        .authenticate(extractToken(socket))
        .then(({ user, expiresInMs }) => {
          const data = (socket as AppSocket).data;
          data.user = user;
          // Socket không được sống lâu hơn quyền: token hết hạn → ngắt, client nối lại bằng token mới.
          data.expiryTimer = setTimeout(
            () => socket.disconnect(true),
            Math.min(expiresInMs, MAX_TIMER_MS),
          );
          data.expiryTimer.unref();
          next();
        })
        .catch((error: unknown) => {
          const socketError = toSocketError(error);
          next(Object.assign(new Error(socketError.message), { data: socketError }));
        });
    });
  }

  handleDisconnect(socket: AppSocket): void {
    clearTimeout(socket.data.expiryTimer);
  }

  @SubscribeMessage(ORDER_SUBSCRIBE)
  async subscribe(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() body: unknown,
  ): Promise<SubscribeAck> {
    const orderId = (body as { orderId?: unknown } | null)?.orderId;
    const ack = await this.tracking.subscribe(
      socket.data.user,
      orderId,
      subscribedOrderIds(socket.rooms),
    );
    if (ack.ok) await socket.join(orderRoom(ack.order.id));
    return ack;
  }

  @SubscribeMessage(ORDER_UNSUBSCRIBE)
  async unsubscribe(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() body: unknown,
  ): Promise<{ ok: true }> {
    const orderId = (body as { orderId?: unknown } | null)?.orderId;
    if (typeof orderId === 'string') await socket.leave(orderRoom(orderId));
    return { ok: true };
  }

  /** Chỉ gửi vào room của đơn; Redis adapter chuyển tiếp tới socket ở các instance khác. */
  emitOrderUpdated(payload: OrderUpdatedPayload): void {
    this.server.to(orderRoom(payload.orderId)).emit(ORDER_UPDATED, payload);
    this.logger.debug(`Emitted ${ORDER_UPDATED} for order ${payload.orderId}`);
  }
}
