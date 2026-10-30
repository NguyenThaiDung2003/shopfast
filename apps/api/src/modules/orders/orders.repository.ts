import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { CheckoutLine } from '../cart/cart.repository';

const MAX_INT32 = 2_147_483_647;

const orderDetailSelect = {
  id: true,
  code: true,
  userId: true,
  status: true,
  totalAmount: true,
  paidAt: true,
  createdAt: true,
  recipientName: true,
  recipientPhone: true,
  shippingAddress: true,
  shippingNote: true,
  user: { select: { id: true, fullName: true, email: true } },
  items: {
    select: {
      productId: true,
      quantity: true,
      unitPrice: true,
      product: { select: { sku: true, name: true } },
    },
    orderBy: { productId: 'asc' },
  },
  statusHistory: {
    select: {
      fromStatus: true,
      toStatus: true,
      note: true,
      createdAt: true,
      changedBy: { select: { id: true, fullName: true, role: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.OrderSelect;

export type OrderRecord = Prisma.OrderGetPayload<{ select: typeof orderDetailSelect }>;

/** Bộ lọc lịch sử đơn của khách. */
/** Thông tin nhận hàng lúc đặt đơn. */
export interface ShippingInfo {
  recipientName: string;
  phone: string;
  address: string;
  note?: string;
}

export interface OrderListFilter {
  statuses?: OrderStatus[];
  /** Mã đơn hoặc tên sản phẩm (không phân biệt hoa thường). */
  q?: string;
}

/** Số đơn theo từng trạng thái (trạng thái không có đơn = 0). */
export type OrderStatusCounts = Record<OrderStatus, number>;

export interface StatusChange {
  orderId: string;
  from: OrderStatus;
  to: OrderStatus;
  changedById: string;
  note?: string;
}

export interface RestockedItem {
  productId: number;
  sku: string;
  quantity: number;
  stockAfter: number;
}

export type ChangeStatusResult =
  | { status: 'updated'; order: OrderRecord; restocked: RestockedItem[] }
  /** Trạng thái trong DB không còn là `from` – một request khác vừa đổi trước. */
  | { status: 'conflict' }
  | { status: 'busy' };

export interface Shortage {
  productId: number;
  sku: string;
  name: string;
  requested: number;
  available: number;
}

export type CreateOrderResult =
  | { status: 'created'; order: OrderRecord; stockAfter: Map<number, number> }
  | { status: 'insufficient_stock'; shortages: Shortage[] }
  /** Đơn khác cùng (user, Idempotency-Key) đã được tạo trước. */
  | { status: 'duplicate' }
  /** Không lấy được connection / transaction quá hạn khi tải cao. */
  | { status: 'busy' }
  | { status: 'total_overflow' };

/** Ném trong transaction để rollback toàn bộ; bắt lại ngay bên ngoài. */
class RollbackSignal extends Error {
  constructor(readonly result: CreateOrderResult | ChangeStatusResult) {
    super(result.status);
  }
}

// Giữ transaction ngắn; maxWait cho phép chờ connection khi nhiều request cùng tranh một dòng.
const CHECKOUT_TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tạo đơn từ giỏ trong MỘT transaction (cơ chế khoá: ADR-0005):
   * 1. INSERT đơn trước → request trùng Idempotency-Key bị chặn ở unique index trước khi chạm kho.
   * 2. Trừ kho từng sản phẩm theo productId tăng dần (cùng thứ tự khoá → không deadlock) bằng
   *    UPDATE nguyên tử có điều kiện; 0 dòng bị ảnh hưởng = thiếu hàng.
   * 3. Thiếu bất kỳ sản phẩm nào → rollback toàn bộ (kể cả các dòng đã trừ và đơn đã chèn).
   * 4. Ghi order_items với giá đọc từ dòng đang bị chính transaction khoá, cập nhật tổng, xoá giỏ.
   */
  async createFromCart(
    userId: string,
    lines: CheckoutLine[],
    idempotencyKey?: string,
    shipping?: ShippingInfo,
  ): Promise<CreateOrderResult> {
    const sorted = [...lines].sort((a, b) => a.productId - b.productId);
    const productIds = sorted.map((l) => l.productId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const { id: orderId } = await tx.order.create({
          data: {
            userId,
            totalAmount: 0,
            idempotencyKey,
            recipientName: shipping?.recipientName,
            recipientPhone: shipping?.phone,
            shippingAddress: shipping?.address,
            shippingNote: shipping?.note || null,
          },
          select: { id: true },
        });
        await tx.orderStatusHistory.create({
          data: { orderId, toStatus: OrderStatus.PENDING_PAYMENT, changedById: userId },
        });

        const short: CheckoutLine[] = [];
        for (const line of sorted) {
          const affected = await tx.$executeRaw`
            UPDATE products
            SET stock = stock - ${line.quantity}, updated_at = now()
            WHERE id = ${line.productId} AND stock >= ${line.quantity}`;
          if (affected !== 1) short.push(line);
        }

        if (short.length > 0) {
          const found = await tx.product.findMany({
            where: { id: { in: short.map((l) => l.productId) } },
            select: { id: true, sku: true, name: true, stock: true },
          });
          const byId = new Map(found.map((p) => [p.id, p]));
          throw new RollbackSignal({
            status: 'insufficient_stock',
            shortages: short.map((l) => ({
              productId: l.productId,
              sku: byId.get(l.productId)?.sku ?? '',
              name: byId.get(l.productId)?.name ?? `#${l.productId}`,
              requested: l.quantity,
              available: byId.get(l.productId)?.stock ?? 0,
            })),
          });
        }

        const products = await tx.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, price: true, stock: true },
        });
        const priceById = new Map(products.map((p) => [p.id, p.price]));
        const items = sorted.map((l) => ({
          orderId,
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: priceById.get(l.productId)!,
        }));
        const total = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
        if (total > MAX_INT32) throw new RollbackSignal({ status: 'total_overflow' });

        await tx.orderItem.createMany({ data: items });
        await tx.order.update({ where: { id: orderId }, data: { totalAmount: total } });
        await tx.cartItem.deleteMany({ where: { userId, productId: { in: productIds } } });

        const order = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          select: orderDetailSelect,
        });
        return {
          status: 'created' as const,
          order,
          stockAfter: new Map(products.map((p) => [p.id, p.stock])),
        };
      }, CHECKOUT_TX_OPTIONS);
    } catch (error) {
      if (error instanceof RollbackSignal) return error.result as CreateOrderResult;
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002' && idempotencyKey) return { status: 'duplicate' };
        if (error.code === 'P2028') return { status: 'busy' };
      }
      throw error;
    }
  }

  /**
   * Đổi trạng thái trong MỘT transaction (ADR-0006):
   * 1. Compare-and-set `UPDATE … WHERE id = $id AND status = $from` – hai nhân viên bấm cùng lúc
   *    thì chỉ một người thắng, người kia nhận 'conflict' (không ghi đè lên nhau).
   * 2. Ghi lịch sử (ai, lúc nào, ghi chú).
   * 3. Huỷ đơn → hoàn kho từng dòng theo productId tăng dần (cùng thứ tự khoá với checkout).
   * Kiểm tra bước chuyển có hợp lệ hay không là việc của state machine ở service.
   */
  async changeStatus(change: StatusChange): Promise<ChangeStatusResult> {
    const { orderId, from, to, changedById, note } = change;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.order.updateMany({
          where: { id: orderId, status: from },
          data: { status: to, ...(to === OrderStatus.PAID && { paidAt: new Date() }) },
        });
        if (count !== 1) throw new RollbackSignal({ status: 'conflict' });

        await tx.orderStatusHistory.create({
          data: { orderId, fromStatus: from, toStatus: to, changedById, note },
        });

        const restocked: RestockedItem[] = [];
        if (to === OrderStatus.CANCELLED) {
          const items = await tx.orderItem.findMany({
            where: { orderId },
            select: { productId: true, quantity: true },
            orderBy: { productId: 'asc' },
          });
          for (const item of items) {
            const [row] = await tx.$queryRaw<Array<{ sku: string; stock: number }>>`
              UPDATE products SET stock = stock + ${item.quantity}, updated_at = now()
              WHERE id = ${item.productId}
              RETURNING sku, stock`;
            if (row) restocked.push({ ...item, sku: row.sku, stockAfter: row.stock });
          }
        }

        const order = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          select: orderDetailSelect,
        });
        return { status: 'updated' as const, order, restocked };
      }, CHECKOUT_TX_OPTIONS);
    } catch (error) {
      if (error instanceof RollbackSignal) return error.result as ChangeStatusResult;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028') {
        return { status: 'busy' };
      }
      throw error;
    }
  }

  findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<OrderRecord | null> {
    return this.prisma.order.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      select: orderDetailSelect,
    });
  }

  findById(id: string): Promise<OrderRecord | null> {
    return this.prisma.order.findUnique({ where: { id }, select: orderDetailSelect });
  }

  findByCode(code: string): Promise<OrderRecord | null> {
    return this.prisma.order.findUnique({ where: { code }, select: orderDetailSelect });
  }

  /**
   * Lịch sử đơn của khách. `statusCounts` đếm theo từng trạng thái với cùng từ khoá `q` nhưng
   * KHÔNG áp bộ lọc trạng thái – để mọi tab đều hiện đúng số đơn.
   */
  async findPageByUser(
    userId: string,
    filter: OrderListFilter,
    skip: number,
    take: number,
  ): Promise<{ items: OrderRecord[]; total: number; statusCounts: OrderStatusCounts }> {
    const base: Prisma.OrderWhereInput = { userId };
    if (filter.q) {
      base.OR = [
        { code: { contains: filter.q, mode: 'insensitive' } },
        { items: { some: { product: { name: { contains: filter.q, mode: 'insensitive' } } } } },
      ];
    }
    return this.findCountedPage(base, filter, skip, take);
  }

  /** Danh sách đơn cho nhân viên: `q` tìm thêm theo tên/email khách. */
  async findPage(
    filter: OrderListFilter,
    skip: number,
    take: number,
  ): Promise<{ items: OrderRecord[]; total: number; statusCounts: OrderStatusCounts }> {
    const base: Prisma.OrderWhereInput = {};
    if (filter.q) {
      const contains = { contains: filter.q, mode: 'insensitive' } as const;
      base.OR = [
        { code: contains },
        { items: { some: { product: { name: contains } } } },
        { user: { fullName: contains } },
        { user: { email: contains } },
      ];
    }
    return this.findCountedPage(base, filter, skip, take);
  }

  /**
   * Trang đơn + số đơn theo trạng thái. `base` là điều kiện chung (chủ đơn, từ khoá); số đếm
   * áp `base` nhưng không áp bộ lọc trạng thái để mọi tab đều có số.
   */
  private async findCountedPage(
    base: Prisma.OrderWhereInput,
    filter: OrderListFilter,
    skip: number,
    take: number,
  ): Promise<{ items: OrderRecord[]; total: number; statusCounts: OrderStatusCounts }> {
    const where: Prisma.OrderWhereInput = filter.statuses?.length
      ? { ...base, status: { in: filter.statuses } }
      : base;

    const [items, total, groups] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        select: orderDetailSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.order.count({ where }),
      this.prisma.order.groupBy({
        by: ['status'],
        where: base,
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
    ]);

    const statusCounts = Object.fromEntries(
      Object.values(OrderStatus).map((status) => [status, 0]),
    ) as OrderStatusCounts;
    for (const group of groups) {
      const count = group._count;
      statusCounts[group.status] = typeof count === 'object' && count ? (count._all ?? 0) : 0;
    }
    return { items, total, statusCounts };
  }
}
