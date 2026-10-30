import { Injectable } from '@nestjs/common';
import { OrderStatus, PendingActionStatus, PendingActionType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

const pendingActionSelect = {
  id: true,
  type: true,
  status: true,
  payload: true,
  summary: true,
  orderId: true,
  ticketId: true,
  proposedById: true,
  decidedById: true,
  decidedAt: true,
  decisionNote: true,
  errorCode: true,
  createdAt: true,
  order: { select: { code: true } },
  ticket: { select: { code: true } },
} satisfies Prisma.PendingActionSelect;

export type PendingActionRecord = Prisma.PendingActionGetPayload<{
  select: typeof pendingActionSelect;
}>;

export interface NewPendingAction {
  type: PendingActionType;
  orderId: string;
  ticketId?: string;
  reason: string;
  summary: string;
  proposedById: string;
}

export type ProposeResult =
  | { status: 'created'; action: PendingActionRecord }
  /** Đã có đề xuất cùng loại cho đơn này đang chờ/đang chạy (partial unique index). */
  | { status: 'duplicate'; action: PendingActionRecord };

export type CreateReturnResult =
  | { status: 'created'; returnRequestId: string }
  | { status: 'not_delivered'; orderStatus: OrderStatus | null }
  /** Đơn đã có yêu cầu đổi trả đang mở. */
  | { status: 'duplicate' };

/** Ném trong transaction để rollback; bắt lại ngay bên ngoài. */
class RollbackSignal extends Error {
  constructor(readonly result: CreateReturnResult) {
    super(result.status);
  }
}

@Injectable()
export class PendingActionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: NewPendingAction): Promise<ProposeResult> {
    try {
      const action = await this.prisma.pendingAction.create({
        data: {
          type: input.type,
          orderId: input.orderId,
          ticketId: input.ticketId,
          payload: { reason: input.reason },
          summary: input.summary,
          proposedById: input.proposedById,
        },
        select: pendingActionSelect,
      });
      return { status: 'created', action };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.pendingAction.findFirst({
          where: {
            type: input.type,
            orderId: input.orderId,
            status: { in: [PendingActionStatus.PENDING, PendingActionStatus.EXECUTING] },
          },
          select: pendingActionSelect,
        });
        if (existing) return { status: 'duplicate', action: existing };
      }
      throw error;
    }
  }

  findById(id: string): Promise<PendingActionRecord | null> {
    return this.prisma.pendingAction.findUnique({ where: { id }, select: pendingActionSelect });
  }

  async findPage(
    status: PendingActionStatus | undefined,
    skip: number,
    take: number,
  ): Promise<{ items: PendingActionRecord[]; total: number }> {
    const where = (status ? { status } : {}) satisfies Prisma.PendingActionWhereInput;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.pendingAction.findMany({
        where,
        select: pendingActionSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.pendingAction.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Giành quyền thực thi: compare-and-set PENDING → EXECUTING. Hai nhân viên bấm "xác nhận"
   * cùng lúc thì chỉ một người được true; người kia không chạy lại thao tác.
   */
  async claim(id: string, decidedById: string, note?: string): Promise<boolean> {
    const { count } = await this.prisma.pendingAction.updateMany({
      where: { id, status: PendingActionStatus.PENDING },
      data: {
        status: PendingActionStatus.EXECUTING,
        decidedById,
        decidedAt: new Date(),
        decisionNote: note,
      },
    });
    return count === 1;
  }

  /** Thực thi gặp lỗi tạm thời (hệ thống bận): trả đề xuất về PENDING để xác nhận lại sau. */
  async releaseClaim(id: string): Promise<void> {
    await this.prisma.pendingAction.updateMany({
      where: { id, status: PendingActionStatus.EXECUTING },
      data: {
        status: PendingActionStatus.PENDING,
        decidedById: null,
        decidedAt: null,
        decisionNote: null,
      },
    });
  }

  async reject(id: string, decidedById: string, note?: string): Promise<boolean> {
    const { count } = await this.prisma.pendingAction.updateMany({
      where: { id, status: PendingActionStatus.PENDING },
      data: {
        status: PendingActionStatus.REJECTED,
        decidedById,
        decidedAt: new Date(),
        decisionNote: note,
      },
    });
    return count === 1;
  }

  async markExecuted(id: string): Promise<void> {
    await this.prisma.pendingAction.updateMany({
      where: { id, status: PendingActionStatus.EXECUTING },
      data: { status: PendingActionStatus.EXECUTED },
    });
  }

  async markFailed(id: string, errorCode: string): Promise<void> {
    await this.prisma.pendingAction.updateMany({
      where: { id, status: PendingActionStatus.EXECUTING },
      data: { status: PendingActionStatus.FAILED, errorCode },
    });
  }

  /**
   * Tạo yêu cầu đổi trả và đánh dấu đề xuất EXECUTED trong MỘT transaction: không có trường hợp
   * đã có yêu cầu mà đề xuất vẫn kẹt EXECUTING. Kiểm lại đơn DELIVERED ngay lúc thực thi.
   */
  async createReturnRequest(
    actionId: string,
    orderId: string,
    reason: string,
    createdById: string,
  ): Promise<CreateReturnResult> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const order = await tx.order.findUnique({
            where: { id: orderId },
            select: { status: true },
          });
          if (order?.status !== OrderStatus.DELIVERED) {
            throw new RollbackSignal({
              status: 'not_delivered',
              orderStatus: order?.status ?? null,
            });
          }
          const { id } = await tx.returnRequest.create({
            data: { orderId, reason, createdById, pendingActionId: actionId },
            select: { id: true },
          });
          await tx.pendingAction.updateMany({
            where: { id: actionId, status: PendingActionStatus.EXECUTING },
            data: { status: PendingActionStatus.EXECUTED },
          });
          return { status: 'created' as const, returnRequestId: id };
        },
        { maxWait: 5_000, timeout: 10_000 },
      );
    } catch (error) {
      if (error instanceof RollbackSignal) return error.result;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { status: 'duplicate' };
      }
      throw error;
    }
  }
}
