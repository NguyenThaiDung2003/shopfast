import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

const orderForJobSelect = {
  id: true,
  code: true,
  status: true,
  totalAmount: true,
  paidAt: true,
  createdAt: true,
  user: { select: { email: true, fullName: true } },
  items: {
    select: {
      quantity: true,
      unitPrice: true,
      product: { select: { sku: true, name: true } },
    },
    orderBy: { productId: 'asc' },
  },
} satisfies Prisma.OrderSelect;

export type OrderForJob = Prisma.OrderGetPayload<{ select: typeof orderForJobSelect }>;

export interface AdminRecipient {
  id: string;
  email: string;
  fullName: string;
}

export interface DailyRevenue {
  /** Tổng tiền đơn thanh toán trong ngày (trừ đơn đã huỷ sau đó), VND. */
  revenue: number;
  paidOrders: number;
  newOrders: number;
  cancelledOrders: number;
  topProducts: Array<{ sku: string; name: string; quantity: number; revenue: number }>;
}

/** Dữ liệu cho worker (F05). Job chỉ mang id nên mọi thứ đọc mới từ DB lúc chạy (ADR-0009). */
@Injectable()
export class JobsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findOrder(orderId: string): Promise<OrderForJob | null> {
    return this.prisma.order.findUnique({ where: { id: orderId }, select: orderForJobSelect });
  }

  findAdmins(): Promise<AdminRecipient[]> {
    return this.prisma.user.findMany({
      where: { role: Role.ADMIN },
      select: { id: true, email: true, fullName: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Doanh thu trong [from, to): đơn có paidAt trong khoảng, không tính đơn đã huỷ. */
  async dailyRevenue(from: Date, to: Date): Promise<DailyRevenue> {
    const paidWhere: Prisma.OrderWhereInput = {
      paidAt: { gte: from, lt: to },
      status: { not: OrderStatus.CANCELLED },
    };
    const [paid, newOrders, cancelledOrders, topProducts] = await Promise.all([
      this.prisma.order.aggregate({ where: paidWhere, _sum: { totalAmount: true }, _count: true }),
      this.prisma.order.count({ where: { createdAt: { gte: from, lt: to } } }),
      this.prisma.orderStatusHistory.count({
        where: { toStatus: OrderStatus.CANCELLED, createdAt: { gte: from, lt: to } },
      }),
      this.prisma.$queryRaw<DailyRevenue['topProducts']>`
        SELECT p.sku, p.name,
               SUM(oi.quantity)::int AS quantity,
               SUM(oi.quantity::bigint * oi.unit_price)::bigint AS revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        WHERE o.paid_at >= ${from} AND o.paid_at < ${to} AND o.status <> 'CANCELLED'
        GROUP BY p.id
        ORDER BY revenue DESC, p.id
        LIMIT 5`,
    ]);
    return {
      revenue: paid._sum.totalAmount ?? 0,
      paidOrders: paid._count,
      newOrders,
      cancelledOrders,
      topProducts: topProducts.map((p) => ({ ...p, revenue: Number(p.revenue) })),
    };
  }
}
