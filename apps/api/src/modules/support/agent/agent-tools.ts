import { Injectable, Logger } from '@nestjs/common';
import { PendingActionType } from '@prisma/client';
import { AppException } from '../../../common/exceptions/app.exception';
import type { AuthUser } from '../../auth/auth.types';
import { CatalogService } from '../../catalog/catalog.service';
import type { LlmToolCall, LlmToolSpec } from '../../llm/llm.types';
import { allowedNext, ORDER_STATUS_LABELS } from '../../orders/order-status.machine';
import { OrdersService } from '../../orders/orders.service';
import { PendingActionDto } from '../dto/pending-action.response';
import { PendingActionsService } from '../pending-actions.service';

/** Mọi tool đều strict: object có `required` đủ và `additionalProperties: false`. */
const objectSchema = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const ORDER_REF = {
  type: 'string',
  description: 'Mã đơn hiển thị (ví dụ SF-000123) hoặc id UUID của đơn.',
};
const REASON = {
  type: 'string',
  description: 'Lý do ngắn gọn bằng tiếng Việt, dựa trên yêu cầu của khách hoặc nhân viên.',
};

export const AGENT_TOOLS: LlmToolSpec[] = [
  {
    name: 'getOrderStatus',
    description:
      'Tra trạng thái hiện tại của một đơn hàng trong hệ thống: trạng thái, tổng tiền, ngày tạo, ' +
      'ngày thanh toán, các sản phẩm, lần đổi trạng thái gần nhất và các bước có thể chuyển tiếp. ' +
      'Bắt buộc gọi trước khi nói bất cứ điều gì về một đơn.',
    inputSchema: objectSchema({ orderRef: ORDER_REF }),
  },
  {
    name: 'checkStock',
    description:
      'Tra số tồn kho hiện tại (đọc trực tiếp DB) của một sản phẩm theo SKU, ví dụ SF-DT-0001. ' +
      'Bắt buộc gọi trước khi nói về tồn kho hay còn hàng.',
    inputSchema: objectSchema({
      sku: { type: 'string', description: 'Mã SKU của sản phẩm, ví dụ SF-DT-0001.' },
    }),
  },
  {
    name: 'proposeCancelOrder',
    description:
      'Tạo ĐỀ XUẤT huỷ đơn để nhân viên xác nhận. KHÔNG huỷ đơn: đơn chỉ bị huỷ khi nhân viên ' +
      'bấm xác nhận đề xuất. Chỉ huỷ được đơn chưa giao (Chờ thanh toán, Đã thanh toán, Đang xử lý).',
    inputSchema: objectSchema({ orderRef: ORDER_REF, reason: REASON }),
  },
  {
    name: 'proposeReturnRequest',
    description:
      'Tạo ĐỀ XUẤT yêu cầu đổi trả để nhân viên xác nhận. KHÔNG tạo yêu cầu: yêu cầu chỉ được ' +
      'tạo khi nhân viên bấm xác nhận. Chỉ áp dụng cho đơn đã giao.',
    inputSchema: objectSchema({ orderRef: ORDER_REF, reason: REASON }),
  },
];

export interface ToolContext {
  staff: AuthUser;
  ticketId: string;
}

export interface ToolExecution {
  /** JSON gửi lại cho model. */
  content: string;
  ok: boolean;
  /** Đề xuất vừa tạo (tool propose*), để trả cho nhân viên. */
  pendingAction?: PendingActionDto;
}

/** Input do model sinh không hợp lệ – báo lại cho model tự sửa, không ném ra ngoài. */
class ToolInputError extends Error {}

function readString(
  input: unknown,
  key: string,
  { min, max, pattern }: { min: number; max: number; pattern?: RegExp },
): string {
  const value =
    typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>)[key]
      : undefined;
  if (typeof value !== 'string') throw new ToolInputError(`Thiếu trường "${key}" (chuỗi).`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new ToolInputError(`Trường "${key}" phải dài ${min}–${max} ký tự.`);
  }
  if (pattern && !pattern.test(trimmed)) {
    throw new ToolInputError(`Trường "${key}" sai định dạng.`);
  }
  return trimmed;
}

const ORDER_REF_RULE = { min: 3, max: 64, pattern: /^[A-Za-z0-9-]+$/ };
const SKU_RULE = { min: 3, max: 64, pattern: /^[A-Za-z0-9_-]+$/ };
const REASON_RULE = { min: 3, max: 500 };

/**
 * Thực thi tool cho trợ lý AI. Tool đọc gọi service nghiệp vụ thật (đúng luật quyền như HTTP);
 * tool ghi CHỈ tạo PendingAction – không có đường nào từ đây chạm vào changeStatus.
 */
@Injectable()
export class AgentToolsService {
  private readonly logger = new Logger(AgentToolsService.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly catalogService: CatalogService,
    private readonly pendingActions: PendingActionsService,
  ) {}

  async execute(call: LlmToolCall, context: ToolContext): Promise<ToolExecution> {
    try {
      switch (call.name) {
        case 'getOrderStatus':
          return ok(await this.getOrderStatus(call.input, context));
        case 'checkStock':
          return ok(await this.checkStock(call.input));
        case 'proposeCancelOrder':
          return await this.propose(PendingActionType.CANCEL_ORDER, call.input, context);
        case 'proposeReturnRequest':
          return await this.propose(PendingActionType.CREATE_RETURN_REQUEST, call.input, context);
        default:
          return fail('UNKNOWN_TOOL', `Không có tool "${call.name}".`);
      }
    } catch (error) {
      if (error instanceof ToolInputError) return fail('INVALID_INPUT', error.message);
      if (error instanceof AppException) return fail(error.code, error.userMessage);
      this.logger.error(`Tool ${call.name} failed: ${(error as Error).message}`);
      return fail('INTERNAL_ERROR', 'Lỗi hệ thống khi tra cứu, không có dữ liệu.');
    }
  }

  private async getOrderStatus(input: unknown, { staff }: ToolContext) {
    const ref = readString(input, 'orderRef', ORDER_REF_RULE);
    const order = await this.ordersService.findByRef(staff, ref);
    const last = order.statusHistory.at(-1);
    return {
      code: order.code,
      status: order.status,
      statusLabel: ORDER_STATUS_LABELS[order.status],
      totalAmountVnd: order.totalAmount,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      items: order.items.map(({ sku, name, quantity }) => ({ sku, name, quantity })),
      lastChange: last ? { to: last.to, at: last.changedAt, note: last.note } : null,
      allowedNext: allowedNext(order.status).map((s) => ({
        status: s,
        label: ORDER_STATUS_LABELS[s],
      })),
    };
  }

  private async checkStock(input: unknown) {
    const sku = readString(input, 'sku', SKU_RULE);
    const product = await this.catalogService.stockBySku(sku);
    return {
      sku: product.sku,
      name: product.name,
      stock: product.stock,
      inStock: product.stock > 0,
    };
  }

  private async propose(
    type: PendingActionType,
    input: unknown,
    { staff, ticketId }: ToolContext,
  ): Promise<ToolExecution> {
    const orderRef = readString(input, 'orderRef', ORDER_REF_RULE);
    const reason = readString(input, 'reason', REASON_RULE);
    const { action, created } = await this.pendingActions.propose(staff, {
      type,
      orderRef,
      reason,
      ticketId,
    });
    return {
      ok: true,
      pendingAction: action,
      content: JSON.stringify({
        pendingActionId: action.id,
        status: action.status,
        alreadyPending: !created,
        summary: action.summary,
        note: 'Đây chỉ là ĐỀ XUẤT, chưa thực thi. Thao tác chỉ chạy khi nhân viên xác nhận.',
      }),
    };
  }
}

function ok(data: unknown): ToolExecution {
  return { ok: true, content: JSON.stringify(data) };
}

function fail(code: string, message: string): ToolExecution {
  return { ok: false, content: JSON.stringify({ error: { code, message } }) };
}
