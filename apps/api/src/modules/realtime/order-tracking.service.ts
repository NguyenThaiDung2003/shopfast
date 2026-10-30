import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import { AppException } from '../../common/exceptions/app.exception';
import { FALLBACK_ERROR_MESSAGE } from '../../common/messages/vi';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { AuthUser } from '../auth/auth.types';
import { accessTokenRemainingMs, TokenService } from '../auth/token.service';
import type { OrderStatusChangedEvent } from '../orders/events/order-status-changed.event';
import { OrdersService } from '../orders/orders.service';
import type { OrderUpdatedPayload, SocketError, SubscribeAck } from './realtime.events';

export interface SocketSession {
  user: AuthUser;
  /** Thời gian còn lại của access token; hết thì server ngắt kết nối. */
  expiresInMs: number;
}

export function toOrderUpdatedPayload(event: OrderStatusChangedEvent): OrderUpdatedPayload {
  return {
    orderId: event.orderId,
    code: event.code,
    from: event.from,
    to: event.to,
    occurredAt: event.occurredAt.toISOString(),
  };
}

/** AppException → lỗi gửi qua socket; lỗi khác không lộ chi tiết ra client. */
export function toSocketError(error: unknown): SocketError {
  if (error instanceof AppException) return { code: error.code, message: error.userMessage };
  return { code: 'INTERNAL_ERROR', message: FALLBACK_ERROR_MESSAGE };
}

/**
 * Logic theo dõi đơn realtime (F02, ADR-0010): xác thực kết nối, kiểm quyền vào room.
 * Gateway chỉ chuyển dữ liệu socket ↔ service.
 */
@Injectable()
export class OrderTrackingService {
  private readonly logger = new Logger(OrderTrackingService.name);
  private readonly maxSubscriptions: number;

  constructor(
    private readonly tokenService: TokenService,
    private readonly ordersService: OrdersService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.maxSubscriptions = config.get('WS_MAX_SUBSCRIPTIONS', { infer: true });
  }

  /** Kiểm token tại handshake. Thiếu/sai/hết hạn → AppException 401 (client nhận connect_error). */
  async authenticate(token: string | undefined, now = Date.now()): Promise<SocketSession> {
    if (!token) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Bạn cần đăng nhập để tiếp tục.',
      );
    }
    const user = await this.tokenService.verifyAccessToken(token);
    return { user, expiresInMs: accessTokenRemainingMs(token, now) };
  }

  /**
   * Cho phép vào room của đơn khi user là chủ đơn hoặc nhân viên – đúng luật của
   * `OrdersService.findOne`. Đơn của người khác → ORDER_NOT_FOUND (không lộ đơn có tồn tại).
   * Ack mang trạng thái hiện tại để client bù các thay đổi đã lỡ khi mất kết nối.
   */
  async subscribe(
    user: AuthUser,
    orderId: unknown,
    alreadySubscribed: readonly string[],
  ): Promise<SubscribeAck> {
    if (typeof orderId !== 'string' || !isUUID(orderId)) {
      return fail('VALIDATION_FAILED', 'Mã đơn hàng không hợp lệ.');
    }
    if (!alreadySubscribed.includes(orderId) && alreadySubscribed.length >= this.maxSubscriptions) {
      return fail(
        'TOO_MANY_SUBSCRIPTIONS',
        `Mỗi kết nối chỉ theo dõi được tối đa ${this.maxSubscriptions} đơn cùng lúc.`,
      );
    }

    try {
      const order = await this.ordersService.findOne(user, orderId);
      return { ok: true, order: { id: order.id, code: order.code, status: order.status } };
    } catch (error) {
      if (!(error instanceof AppException)) {
        this.logger.error(`Subscribe order ${orderId} failed: ${(error as Error).message}`);
      }
      return { ok: false, error: toSocketError(error) };
    }
  }
}

function fail(code: string, message: string): SubscribeAck {
  return { ok: false, error: { code, message } };
}
