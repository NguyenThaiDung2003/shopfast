// Hiển thị kết quả trợ lý AI (AssistantReplyDto): chip tool call, nhãn outcome, đề xuất.
// Logic thuần – component chỉ đọc từ đây.

import type { BadgeTone } from '../components/ui';

export type AssistantOutcome = 'answered' | 'out_of_scope' | 'limit_reached' | 'ungrounded';
export type PendingActionType = 'CANCEL_ORDER' | 'CREATE_RETURN_REQUEST';
export type PendingActionStatus = 'PENDING' | 'EXECUTING' | 'EXECUTED' | 'REJECTED' | 'FAILED';

/** Khớp AssistantToolCallDto. */
export interface ToolCall {
  name: string;
  input: unknown;
  ok: boolean;
}

/** Tool của agent (apps/api/src/modules/support/agent/agent-tools.ts). */
const TOOL_META: Record<string, { label: string; icon: string }> = {
  getOrderStatus: { label: 'Tra cứu trạng thái đơn', icon: 'local_shipping' },
  checkStock: { label: 'Kiểm tra tồn kho', icon: 'inventory_2' },
  proposeCancelOrder: { label: 'Đề xuất huỷ đơn', icon: 'cancel' },
  proposeReturnRequest: { label: 'Đề xuất đổi trả', icon: 'assignment_return' },
};

/** Trường input đáng hiện trên chip, theo thứ tự ưu tiên. */
const KEY_FIELDS = ['orderRef', 'sku'] as const;

function keyArgument(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  for (const field of KEY_FIELDS) {
    const value = record[field];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 40);
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

export function toolIcon(call: ToolCall): string {
  return TOOL_META[call.name]?.icon ?? 'build';
}

/** "Tra cứu trạng thái đơn: SF-000123", tool lỗi thêm " – lỗi"; tool lạ dùng tên gốc. */
export function toolCallLabel(call: ToolCall): string {
  const base = TOOL_META[call.name]?.label ?? call.name;
  const arg = keyArgument(call.input);
  return `${base}${arg ? `: ${arg}` : ''}${call.ok ? '' : ' – lỗi'}`;
}

export const OUTCOME_META: Record<AssistantOutcome, { label: string; tone: BadgeTone } | null> = {
  answered: null,
  out_of_scope: { label: 'Ngoài phạm vi hỗ trợ', tone: 'neutral' },
  limit_reached: { label: 'Đã dừng – quá số bước tra cứu', tone: 'warning' },
  ungrounded: { label: 'Đã chặn – thông tin chưa được kiểm chứng', tone: 'danger' },
};

export const PENDING_TYPE_META: Record<PendingActionType, { label: string; icon: string }> = {
  CANCEL_ORDER: { label: 'Huỷ đơn', icon: 'cancel' },
  CREATE_RETURN_REQUEST: { label: 'Tạo yêu cầu đổi trả', icon: 'assignment_return' },
};

/** Avatar chữ cái đầu: "Nguyễn Văn Minh" → "NM". */
export function initials(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]![0]!;
  const last = words.length > 1 ? words[words.length - 1]![0]! : '';
  return (first + last).toUpperCase();
}
