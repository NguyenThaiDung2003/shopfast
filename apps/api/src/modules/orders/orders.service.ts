import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStatus, Role } from '@prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { Page, toPage } from '../../common/pagination';
import type { AuthUser } from '../auth/auth.types';
import { CartRepository } from '../cart/cart.repository';
import { PRODUCT_UPDATED, ProductUpdatedEvent } from '../catalog/events/product-updated.event';
import { ListOrdersQuery } from './dto/list-orders.query';
import { OrderDto } from './dto/order.response';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { ORDER_CREATED, OrderCreatedEvent } from './events/order-created.event';
import { ORDER_STATUS_CHANGED, OrderStatusChangedEvent } from './events/order-status-changed.event';
import { assertTransition, ORDER_STATUS_LABELS } from './order-status.machine';
import { OrderRecord, OrdersRepository, RestockedItem, Shortage } from './orders.repository';

export type OrderView = OrderDto;

export interface CreateOrderOutcome {
  order: OrderView;
  /** true: trả lại đơn đã tạo trước đó với cùng Idempotency-Key. */
  replayed: boolean;
}

const STAFF_ROLES: readonly Role[] = [Role.SUPPORT, Role.WAREHOUSE, Role.ADMIN];

const isStaff = (user: AuthUser) => STAFF_ROLES.includes(user.role);

/** Chủ đơn chỉ thấy vai trò của người đổi trạng thái; nhân viên thấy cả id và tên. */
export function toOrderView(order: OrderRecord, viewer: AuthUser): OrderView {
  const { id, code, status, totalAmount, paidAt, createdAt, items, statusHistory } = order;
  const showStaff = isStaff(viewer);
  return {
    id,
    code,
    status,
    totalAmount,
    paidAt,
    createdAt,
    items: items.map(({ productId, quantity, unitPrice, product }) => ({
      productId,
      sku: product.sku,
      name: product.name,
      quantity,
      unitPrice,
      lineTotal: unitPrice * quantity,
    })),
    statusHistory: statusHistory.map(({ fromStatus, toStatus, note, createdAt, changedBy }) => ({
      from: fromStatus,
      to: toStatus,
      note,
      changedAt: createdAt,
      changedBy: showStaff ? changedBy : { role: changedBy.role },
    })),
  };
}

/** "Không đủ hàng: "A" (SKU-1) còn 2, bạn đặt 3; "B" (SKU-2) đã hết hàng, bạn đặt 1." */
export function formatShortages(shortages: Shortage[]): string {
  const parts = shortages.map(({ name, sku, requested, available }) => {
    const label = sku ? `"${name}" (${sku})` : `"${name}"`;
    const left = available === 0 ? 'đã hết hàng' : `còn ${available}`;
    return `${label} ${left}, bạn đặt ${requested}`;
  });
  return `Không đủ hàng: ${parts.join('; ')}. Vui lòng cập nhật giỏ hàng.`;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly cartRepository: CartRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(user: AuthUser, idempotencyKey?: string): Promise<CreateOrderOutcome> {
    const replay = await this.findReplay(user, idempotencyKey);
    if (replay) return replay;

    const lines = await this.cartRepository.findCheckoutLines(user.id);
    if (lines.length === 0) {
      // Request trùng key có thể đọc giỏ ngay sau khi request đầu commit và xoá giỏ:
      // tra lại key để trả đơn đó thay vì báo giỏ trống.
      const lateReplay = await this.findReplay(user, idempotencyKey);
      if (lateReplay) return lateReplay;
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'CART_EMPTY',
        'Giỏ hàng đang trống, hãy thêm sản phẩm trước khi đặt hàng.',
      );
    }

    const result = await this.ordersRepository.createFromCart(user.id, lines, idempotencyKey);
    switch (result.status) {
      case 'created':
        this.publishCreated(result.order, result.stockAfter, user);
        return { order: toOrderView(result.order, user), replayed: false };

      case 'insufficient_stock':
        throw new AppException(
          HttpStatus.CONFLICT,
          'OUT_OF_STOCK',
          formatShortages(result.shortages),
          result.shortages,
        );

      case 'duplicate': {
        // Một request khác cùng key vừa tạo đơn (bấm hai lần gần như đồng thời).
        const existing = await this.findReplay(user, idempotencyKey);
        if (existing) return existing;
        throw new AppException(
          HttpStatus.CONFLICT,
          'IDEMPOTENCY_CONFLICT',
          'Yêu cầu đặt hàng này đang được xử lý, vui lòng thử lại sau giây lát.',
        );
      }

      case 'busy':
        throw new AppException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'ORDER_BUSY',
          'Hệ thống đang đông, vui lòng thử đặt hàng lại sau giây lát.',
        );

      case 'total_overflow':
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          'ORDER_TOO_LARGE',
          'Giá trị đơn hàng vượt giới hạn cho phép, vui lòng tách thành nhiều đơn.',
        );
    }
  }

  async listMine(user: AuthUser, query: ListOrdersQuery): Promise<Page<OrderView>> {
    const { page, limit } = query;
    const { items, total } = await this.ordersRepository.findPageByUser(
      user.id,
      (page - 1) * limit,
      limit,
    );
    return toPage(
      items.map((o) => toOrderView(o, user)),
      total,
      page,
      limit,
    );
  }

  /** Chủ đơn hoặc nhân viên; customer khác nhận 404 để không lộ đơn có tồn tại hay không. */
  async findOne(user: AuthUser, orderId: string): Promise<OrderView> {
    const order = await this.ordersRepository.findById(orderId);
    if (!order || (order.userId !== user.id && !isStaff(user))) {
      throw orderNotFound();
    }
    return toOrderView(order, user);
  }

  /**
   * Đổi trạng thái đơn theo state machine (ADR-0006). Bước không hợp lệ → 409;
   * người khác vừa đổi trước (compare-and-set thua) → 409 kèm trạng thái hiện tại.
   */
  async changeStatus(
    user: AuthUser,
    orderId: string,
    dto: UpdateOrderStatusDto,
  ): Promise<OrderView> {
    const current = await this.ordersRepository.findById(orderId);
    if (!current) throw orderNotFound();
    assertTransition(current.status, dto.status);

    const result = await this.ordersRepository.changeStatus({
      orderId,
      from: current.status,
      to: dto.status,
      changedById: user.id,
      note: dto.note,
    });

    if (result.status === 'busy') {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ORDER_BUSY',
        'Hệ thống đang đông, vui lòng thử lại sau giây lát.',
      );
    }
    if (result.status === 'conflict') {
      const latest = await this.ordersRepository.findById(orderId);
      const now = latest ? ORDER_STATUS_LABELS[latest.status] : 'không xác định';
      throw new AppException(
        HttpStatus.CONFLICT,
        'STATUS_CHANGED_CONCURRENTLY',
        `Đơn vừa được người khác cập nhật (hiện: "${now}"). Vui lòng tải lại rồi thử lại.`,
        { current: latest?.status ?? null },
      );
    }

    this.publishStatusChanged(
      result.order,
      current.status,
      user,
      dto.note ?? null,
      result.restocked,
    );
    return toOrderView(result.order, user);
  }

  private async findReplay(
    user: AuthUser,
    idempotencyKey?: string,
  ): Promise<CreateOrderOutcome | null> {
    if (!idempotencyKey) return null;
    const existing = await this.ordersRepository.findByIdempotencyKey(user.id, idempotencyKey);
    return existing ? { order: toOrderView(existing, user), replayed: true } : null;
  }

  /** Chỉ gọi sau khi transaction đã commit (ADR-0004). */
  private publishCreated(
    order: OrderRecord,
    stockAfter: Map<number, number>,
    user: AuthUser,
  ): void {
    this.eventEmitter.emit(
      ORDER_CREATED,
      new OrderCreatedEvent(
        order.id,
        order.code,
        order.userId,
        order.totalAmount,
        order.items.map(({ productId, quantity, unitPrice }) => ({
          productId,
          quantity,
          unitPrice,
        })),
      ),
    );
    // Tồn kho đổi → cache sản phẩm (F04) và realtime (F02) cần biết, giống khi kho sửa tay.
    for (const item of order.items) {
      const to = stockAfter.get(item.productId);
      if (to === undefined) continue;
      this.eventEmitter.emit(
        PRODUCT_UPDATED,
        new ProductUpdatedEvent(
          item.productId,
          item.product.sku,
          { stock: { from: to + item.quantity, to } },
          user,
        ),
      );
    }
  }

  /** Chỉ gọi sau khi transaction đã commit (ADR-0004). */
  private publishStatusChanged(
    order: OrderRecord,
    from: OrderStatus,
    user: AuthUser,
    note: string | null,
    restocked: RestockedItem[],
  ): void {
    this.eventEmitter.emit(
      ORDER_STATUS_CHANGED,
      new OrderStatusChangedEvent(
        order.id,
        order.code,
        order.userId,
        from,
        order.status,
        user,
        note,
      ),
    );
    // Huỷ đơn đã hoàn kho → cache/realtime tồn kho cần biết.
    for (const item of restocked) {
      this.eventEmitter.emit(
        PRODUCT_UPDATED,
        new ProductUpdatedEvent(
          item.productId,
          item.sku,
          { stock: { from: item.stockAfter - item.quantity, to: item.stockAfter } },
          user,
        ),
      );
    }
  }
}

function orderNotFound(): AppException {
  return new AppException(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng.');
}
