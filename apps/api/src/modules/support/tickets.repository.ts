import { Injectable } from '@nestjs/common';
import { CategorySource, Prisma, TicketCategory, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

const ticketSummarySelect = {
  id: true,
  code: true,
  customerId: true,
  subject: true,
  status: true,
  category: true,
  categorySource: true,
  orderId: true,
  lastMessageAt: true,
  createdAt: true,
  order: { select: { code: true } },
  customer: { select: { id: true, fullName: true, email: true } },
} satisfies Prisma.TicketSelect;

const ticketDetailSelect = {
  ...ticketSummarySelect,
  messages: {
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: { role: true, fullName: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.TicketSelect;

export type TicketSummaryRecord = Prisma.TicketGetPayload<{ select: typeof ticketSummarySelect }>;
export type TicketRecord = Prisma.TicketGetPayload<{ select: typeof ticketDetailSelect }>;

export interface NewTicket {
  customerId: string;
  subject: string;
  message: string;
  orderId?: string;
  idempotencyKey?: string;
}

export type CreateTicketResult =
  | { status: 'created'; ticket: TicketRecord }
  /** Ticket khác cùng (khách, Idempotency-Key) đã được tạo trước. */
  | { status: 'duplicate' };

export type AddMessageResult =
  { status: 'added'; ticket: TicketRecord } | { status: 'closed' } | { status: 'not_found' };

/** Bộ lọc "Ticket của tôi". */
export interface MyTicketFilter {
  statuses?: TicketStatus[];
  /** Tìm theo mã ticket hoặc tiêu đề. */
  q?: string;
}

export type TicketStatusCounts = Record<TicketStatus, number>;

export interface TicketFilter {
  status?: TicketStatus;
  category?: TicketCategory;
  /** Tìm theo mã ticket, tiêu đề, mã đơn, tên/email khách. */
  q?: string;
}

/** groupBy status → đủ mọi trạng thái (thiếu = 0). */
function toStatusCounts(
  groups: Array<{ status: TicketStatus; _count?: true | { _all?: number } }>,
): TicketStatusCounts {
  const counts = Object.fromEntries(
    Object.values(TicketStatus).map((status) => [status, 0]),
  ) as TicketStatusCounts;
  for (const group of groups) {
    const count = group._count;
    counts[group.status] = typeof count === 'object' && count ? (count._all ?? 0) : 0;
  }
  return counts;
}

/** Dữ liệu tối thiểu để phân loại: tiêu đề + tin đầu tiên. */
export interface TicketForClassification {
  id: string;
  code: string;
  subject: string;
  firstMessage: string;
  category: TicketCategory | null;
}

@Injectable()
export class TicketsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Ticket + tin nhắn đầu tiên trong MỘT transaction. Trùng Idempotency-Key → 'duplicate'. */
  async create(input: NewTicket): Promise<CreateTicketResult> {
    try {
      const ticket = await this.prisma.$transaction(async (tx) => {
        const { id } = await tx.ticket.create({
          data: {
            customerId: input.customerId,
            subject: input.subject,
            orderId: input.orderId,
            idempotencyKey: input.idempotencyKey,
          },
          select: { id: true },
        });
        await tx.ticketMessage.create({
          data: { ticketId: id, authorId: input.customerId, body: input.message },
        });
        return tx.ticket.findUniqueOrThrow({ where: { id }, select: ticketDetailSelect });
      });
      return { status: 'created', ticket };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        input.idempotencyKey
      ) {
        return { status: 'duplicate' };
      }
      throw error;
    }
  }

  findById(id: string): Promise<TicketRecord | null> {
    return this.prisma.ticket.findUnique({ where: { id }, select: ticketDetailSelect });
  }

  findByIdempotencyKey(customerId: string, idempotencyKey: string): Promise<TicketRecord | null> {
    return this.prisma.ticket.findUnique({
      where: { customerId_idempotencyKey: { customerId, idempotencyKey } },
      select: ticketDetailSelect,
    });
  }

  /** Đơn có thuộc khách này không (ticket chỉ được gắn đơn của chính khách). */
  async orderBelongsTo(orderId: string, customerId: string): Promise<boolean> {
    const count = await this.prisma.order.count({ where: { id: orderId, userId: customerId } });
    return count === 1;
  }

  async findPageByCustomer(
    customerId: string,
    filter: MyTicketFilter,
    skip: number,
    take: number,
  ): Promise<{ items: TicketSummaryRecord[]; total: number; statusCounts: TicketStatusCounts }> {
    const base: Prisma.TicketWhereInput = { customerId };
    if (filter.q) {
      base.OR = [
        { code: { contains: filter.q, mode: 'insensitive' } },
        { subject: { contains: filter.q, mode: 'insensitive' } },
      ];
    }
    const where: Prisma.TicketWhereInput = filter.statuses?.length
      ? { ...base, status: { in: filter.statuses } }
      : base;

    const [items, total, groups] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        select: ticketSummarySelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.groupBy({
        by: ['status'],
        where: base,
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
    ]);

    return { items, total, statusCounts: toStatusCounts(groups) };
  }

  /** Hàng chờ của nhân viên: ticket có tin mới nhất lên trước. */
  async findPage(
    filter: TicketFilter,
    skip: number,
    take: number,
  ): Promise<{ items: TicketSummaryRecord[]; total: number; statusCounts: TicketStatusCounts }> {
    const base: Prisma.TicketWhereInput = filter.category ? { category: filter.category } : {};
    if (filter.q) {
      const contains = { contains: filter.q, mode: 'insensitive' } as const;
      base.OR = [
        { code: contains },
        { subject: contains },
        { order: { code: contains } },
        { customer: { fullName: contains } },
        { customer: { email: contains } },
      ];
    }
    const where: Prisma.TicketWhereInput = filter.status
      ? { ...base, status: filter.status }
      : base;

    const [items, total, groups] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        select: ticketSummarySelect,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.groupBy({
        by: ['status'],
        where: base,
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
    ]);
    return { items, total, statusCounts: toStatusCounts(groups) };
  }

  /**
   * Thêm tin nhắn và cập nhật trạng thái trong MỘT transaction. Điều kiện `status <> CLOSED`
   * nằm trong UPDATE: ticket vừa bị đóng song song thì không chèn được tin.
   */
  async addMessage(
    ticketId: string,
    authorId: string,
    body: string,
    nextStatus: TicketStatus,
  ): Promise<AddMessageResult> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const { count } = await tx.ticket.updateMany({
        where: { id: ticketId, status: { not: TicketStatus.CLOSED } },
        data: { status: nextStatus, lastMessageAt: now },
      });
      if (count !== 1) {
        const exists = await tx.ticket.count({ where: { id: ticketId } });
        return { status: exists ? 'closed' : 'not_found' } as const;
      }
      await tx.ticketMessage.create({ data: { ticketId, authorId, body, createdAt: now } });
      const ticket = await tx.ticket.findUniqueOrThrow({
        where: { id: ticketId },
        select: ticketDetailSelect,
      });
      return { status: 'added', ticket } as const;
    });
  }

  async update(
    ticketId: string,
    change: { status?: TicketStatus; category?: TicketCategory },
  ): Promise<TicketRecord | null> {
    const { count } = await this.prisma.ticket.updateMany({
      where: { id: ticketId },
      data: {
        ...(change.status && { status: change.status }),
        ...(change.category && {
          category: change.category,
          categorySource: CategorySource.STAFF,
          classifiedAt: new Date(),
        }),
      },
    });
    return count === 1 ? this.findById(ticketId) : null;
  }

  async findForClassification(id: string): Promise<TicketForClassification | null> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        subject: true,
        category: true,
        messages: { select: { body: true }, orderBy: { id: 'asc' }, take: 1 },
      },
    });
    if (!ticket) return null;
    const { messages, ...rest } = ticket;
    return { ...rest, firstMessage: messages[0]?.body ?? '' };
  }

  /**
   * Gán nhóm chỉ khi chưa có (compare-and-set `category IS NULL`): job chạy lại hoặc nhân viên
   * đã sửa tay thì không bị ghi đè. Trả true nếu đã gán.
   */
  async setCategoryIfUnset(
    id: string,
    category: TicketCategory,
    source: CategorySource,
  ): Promise<boolean> {
    const { count } = await this.prisma.ticket.updateMany({
      where: { id, category: null },
      data: { category, categorySource: source, classifiedAt: new Date() },
    });
    return count === 1;
  }
}
