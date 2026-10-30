import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { OrderStatus, PendingActionType } from '@prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { Page, toPage } from '../../common/pagination';
import type { AuthUser } from '../auth/auth.types';
import { canTransition, ORDER_STATUS_LABELS } from '../orders/order-status.machine';
import { OrdersService } from '../orders/orders.service';
import { ListPendingActionsQuery } from './dto/list-pending-actions.query';
import { PendingActionDto } from './dto/pending-action.response';
import { PendingActionRecord, PendingActionsRepository } from './pending-actions.repository';

export interface ProposeInput {
  type: PendingActionType;
  /** UUID hoặc mã đơn (SF-000123). */
  orderRef: string;
  reason: string;
  ticketId?: string;
}

export interface ProposeOutcome {
  action: PendingActionDto;
  /** false: đã có đề xuất cùng loại cho đơn này đang chờ – trả lại đề xuất đó. */
  created: boolean;
}

/** Lỗi tạm thời khi thực thi: trả đề xuất về PENDING để xác nhận lại, không đánh FAILED. */
const TRANSIENT_ERROR_CODES = new Set(['ORDER_BUSY']);

export function toPendingActionView(action: PendingActionRecord): PendingActionDto {
  const payload = action.payload as { reason?: unknown } | null;
  return {
    id: action.id,
    type: action.type,
    status: action.status,
    summary: action.summary,
    reason: typeof payload?.reason === 'string' ? payload.reason : '',
    orderId: action.orderId,
    orderCode: action.order.code,
    ticketId: action.ticketId,
    ticketCode: action.ticket?.code ?? null,
    proposedById: action.proposedById,
    decidedById: action.decidedById,
    decidedAt: action.decidedAt,
    decisionNote: action.decisionNote,
    errorCode: action.errorCode,
    createdAt: action.createdAt,
  };
}

/**
 * Thao tác ghi do trợ lý AI đề xuất (ADR-0011). Agent chỉ gọi được `propose`; thao tác thật
 * chỉ chạy trong `confirm`, do nhân viên gọi qua HTTP.
 */
@Injectable()
export class PendingActionsService {
  private readonly logger = new Logger(PendingActionsService.name);

  constructor(
    private readonly repository: PendingActionsRepository,
    private readonly ordersService: OrdersService,
  ) {}

  /**
   * Ghi bản đề xuất PENDING – KHÔNG thay đổi đơn. Kiểm sơ bộ để agent biết ngay đề xuất vô
   * nghĩa (đơn đang giao không huỷ được…); điều kiện được kiểm lại khi xác nhận.
   */
  async propose(staff: AuthUser, input: ProposeInput): Promise<ProposeOutcome> {
    const order = await this.ordersService.findByRef(staff, input.orderRef);

    if (input.type === PendingActionType.CANCEL_ORDER) {
      if (!canTransition(order.status, OrderStatus.CANCELLED)) {
        throw new AppException(
          HttpStatus.CONFLICT,
          'ORDER_NOT_CANCELLABLE',
          `Đơn ${order.code} đang "${ORDER_STATUS_LABELS[order.status]}", không thể huỷ.`,
        );
      }
    } else if (order.status !== OrderStatus.DELIVERED) {
      throw notReturnable(order.code, order.status);
    }

    const verb =
      input.type === PendingActionType.CANCEL_ORDER ? 'Huỷ đơn' : 'Tạo yêu cầu đổi trả cho đơn';
    const result = await this.repository.create({
      type: input.type,
      orderId: order.id,
      ticketId: input.ticketId,
      reason: input.reason,
      summary: `${verb} ${order.code} (hiện "${ORDER_STATUS_LABELS[order.status]}"). Lý do: ${input.reason}`,
      proposedById: staff.id,
    });
    return { action: toPendingActionView(result.action), created: result.status === 'created' };
  }

  async list(query: ListPendingActionsQuery): Promise<Page<PendingActionDto>> {
    const { page, limit, status } = query;
    const { items, total } = await this.repository.findPage(status, (page - 1) * limit, limit);
    return toPage(items.map(toPendingActionView), total, page, limit);
  }

  /**
   * Nhân viên xác nhận → thực thi. Thứ tự:
   * 1. Compare-and-set PENDING → EXECUTING (chỉ một người thắng; bấm lại → 409).
   * 2. Chạy thao tác qua đúng service nghiệp vụ, kiểm lại điều kiện tại thời điểm này.
   * 3. EXECUTED; lỗi nghiệp vụ → FAILED + mã lỗi; lỗi tạm thời → trả về PENDING.
   */
  async confirm(staff: AuthUser, actionId: string, note?: string): Promise<PendingActionDto> {
    const action = await this.findOrThrow(actionId);
    if (!(await this.repository.claim(actionId, staff.id, note))) {
      throw await this.alreadyDecided(actionId);
    }

    try {
      await this.execute(staff, action);
    } catch (error) {
      await this.recordFailure(actionId, error);
      throw error;
    }
    // Thao tác đã chạy: từ đây không được trả đề xuất về PENDING nữa, kể cả khi ghi lỗi.
    if (action.type === PendingActionType.CANCEL_ORDER) {
      try {
        await this.repository.markExecuted(actionId);
      } catch (error) {
        this.logger.error(
          `Order ${action.orderId} cancelled but pending action ${actionId} stays EXECUTING: ${(error as Error).message}`,
        );
      }
    }
    return toPendingActionView(await this.findOrThrow(actionId));
  }

  async reject(staff: AuthUser, actionId: string, note?: string): Promise<PendingActionDto> {
    await this.findOrThrow(actionId);
    if (!(await this.repository.reject(actionId, staff.id, note))) {
      throw await this.alreadyDecided(actionId);
    }
    return toPendingActionView(await this.findOrThrow(actionId));
  }

  private async execute(staff: AuthUser, action: PendingActionRecord): Promise<void> {
    const { reason } = toPendingActionView(action);
    switch (action.type) {
      case PendingActionType.CANCEL_ORDER: {
        // Đi qua state machine + compare-and-set + hoàn kho + event như mọi lần đổi trạng thái (ADR-0006).
        const source = action.ticket ? `ticket ${action.ticket.code}` : 'yêu cầu hỗ trợ';
        await this.ordersService.changeStatus(staff, action.orderId, {
          status: OrderStatus.CANCELLED,
          note: `Huỷ theo ${source} (trợ lý AI đề xuất, nhân viên xác nhận). Lý do: ${reason}`.slice(
            0,
            500,
          ),
        });
        return;
      }
      case PendingActionType.CREATE_RETURN_REQUEST: {
        // Repository đánh EXECUTED trong cùng transaction với việc tạo yêu cầu.
        const result = await this.repository.createReturnRequest(
          action.id,
          action.orderId,
          reason,
          staff.id,
        );
        if (result.status === 'not_delivered') {
          throw notReturnable(action.order.code, result.orderStatus);
        }
        if (result.status === 'duplicate') {
          throw new AppException(
            HttpStatus.CONFLICT,
            'RETURN_REQUEST_EXISTS',
            `Đơn ${action.order.code} đã có yêu cầu đổi trả đang xử lý.`,
          );
        }
        return;
      }
    }
  }

  private async recordFailure(actionId: string, error: unknown): Promise<void> {
    try {
      if (error instanceof AppException && !TRANSIENT_ERROR_CODES.has(error.code)) {
        await this.repository.markFailed(actionId, error.code);
      } else {
        await this.repository.releaseClaim(actionId);
      }
    } catch (recordError) {
      // Đề xuất kẹt EXECUTING: cần xử lý tay (ADR-0011 → Xử lý khi sự cố).
      this.logger.error(
        `Could not record outcome of pending action ${actionId}: ${(recordError as Error).message}`,
      );
    }
  }

  private async findOrThrow(actionId: string): Promise<PendingActionRecord> {
    const action = await this.repository.findById(actionId);
    if (!action) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        'PENDING_ACTION_NOT_FOUND',
        'Không tìm thấy đề xuất.',
      );
    }
    return action;
  }

  private async alreadyDecided(actionId: string): Promise<AppException> {
    const current = await this.repository.findById(actionId);
    return new AppException(
      HttpStatus.CONFLICT,
      'ACTION_ALREADY_DECIDED',
      'Đề xuất này đã được xử lý (xác nhận hoặc từ chối) trước đó. Vui lòng tải lại danh sách.',
      { status: current?.status ?? null },
    );
  }
}

function notReturnable(code: string, status: OrderStatus | null): AppException {
  const now = status ? `"${ORDER_STATUS_LABELS[status]}"` : 'không xác định';
  return new AppException(
    HttpStatus.CONFLICT,
    'ORDER_NOT_RETURNABLE',
    `Chỉ tạo yêu cầu đổi trả cho đơn đã giao; đơn ${code} hiện ${now}.`,
  );
}
