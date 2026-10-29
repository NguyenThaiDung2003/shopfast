import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
  items: {
    select: {
      productId: true,
      quantity: true,
      unitPrice: true,
      product: { select: { sku: true, name: true } },
    },
    orderBy: { productId: 'asc' },
  },
} satisfies Prisma.OrderSelect;

export type OrderRecord = Prisma.OrderGetPayload<{ select: typeof orderDetailSelect }>;

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
  constructor(readonly result: CreateOrderResult) {
    super(result.status);
  }
}

// Giữ transaction ngắn; maxWait cho phép chờ connection khi nhiều request cùng tranh một sản phẩm.
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
  ): Promise<CreateOrderResult> {
    const sorted = [...lines].sort((a, b) => a.productId - b.productId);
    const productIds = sorted.map((l) => l.productId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const { id: orderId } = await tx.order.create({
          data: { userId, totalAmount: 0, idempotencyKey },
          select: { id: true },
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
      if (error instanceof RollbackSignal) return error.result;
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002' && idempotencyKey) return { status: 'duplicate' };
        if (error.code === 'P2028') return { status: 'busy' };
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

  async findPageByUser(
    userId: string,
    skip: number,
    take: number,
  ): Promise<{ items: OrderRecord[]; total: number }> {
    const where: Prisma.OrderWhereInput = { userId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        select: orderDetailSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total };
  }
}
