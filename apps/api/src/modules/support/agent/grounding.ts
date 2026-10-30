import { OrderStatus } from '@prisma/client';
import { ORDER_STATUS_LABELS } from '../../orders/order-status.machine';

/**
 * Kiểm câu trả lời của trợ lý có dựa trên dữ liệu đã tra bằng tool trong CHÍNH lượt này không
 * (ADR-0011). Đây là luật ép bằng code, bổ sung cho system prompt – model có thể bỏ qua prompt.
 *
 * Heuristic, cố ý nghiêng về chặn nhầm hơn là lọt:
 * - Mã đơn (SF-000123) và SKU (SF-DT-0001) nêu trong câu trả lời phải xuất hiện trong kết quả tool
 *   thành công, hoặc trong câu hỏi/ngữ cảnh ticket (nhắc lại mã không phải là "thông tin đơn").
 * - Nêu trạng thái đơn (nhãn tiếng Việt hoặc mã enum) → trạng thái đó phải có trong kết quả tool.
 * - Nói về tồn kho/còn hàng → phải có checkStock thành công.
 */
const ORDER_CODE = /\bSF-\d{6,}\b/gi;
const SKU = /\bSF-[A-Z]{2,}-\d{3,}\b/gi;
const STATUS_TERMS = [
  ...Object.values(OrderStatus),
  ...Object.values(ORDER_STATUS_LABELS).map((label) => label.toLowerCase()),
];
const STOCK_TERMS = /tồn kho|còn hàng|hết hàng|còn\s+\d+\s*(sản phẩm|chiếc|cái|máy)/i;

export interface GroundingEvidence {
  /** Nội dung kết quả tool thành công trong lượt này. */
  toolOutputs: string[];
  /** Tên các tool đã chạy thành công. */
  succeededTools: Set<string>;
  /** Câu hỏi của nhân viên + ngữ cảnh ticket. */
  context: string;
}

export interface GroundingViolation {
  kind: 'order_code' | 'sku' | 'order_status' | 'stock';
  value: string;
}

export function findUngroundedClaims(
  reply: string,
  evidence: GroundingEvidence,
): GroundingViolation[] {
  const known = [...evidence.toolOutputs, evidence.context].join('\n').toUpperCase();
  const violations: GroundingViolation[] = [];

  for (const code of new Set((reply.match(ORDER_CODE) ?? []).map((c) => c.toUpperCase()))) {
    if (!known.includes(code)) violations.push({ kind: 'order_code', value: code });
  }
  for (const sku of new Set((reply.match(SKU) ?? []).map((s) => s.toUpperCase()))) {
    if (!known.includes(sku)) violations.push({ kind: 'sku', value: sku });
  }

  // Trạng thái chỉ hợp lệ khi chính giá trị đó có trong kết quả tool (getOrderStatus, hoặc tool
  // đề xuất – cũng đọc đơn từ DB). Ngữ cảnh ticket không tính: khách có thể viết sai.
  const toolText = evidence.toolOutputs.join('\n');
  const toolLower = toolText.toLowerCase();
  const replyLower = reply.toLowerCase();
  for (const term of STATUS_TERMS) {
    const isEnum = term === term.toUpperCase();
    const mentioned = isEnum ? new RegExp(`\\b${term}\\b`).test(reply) : replyLower.includes(term);
    const grounded = isEnum ? toolText.includes(term) : toolLower.includes(term);
    if (mentioned && !grounded) violations.push({ kind: 'order_status', value: term });
  }
  if (!evidence.succeededTools.has('checkStock')) {
    const match = reply.match(STOCK_TERMS);
    if (match) violations.push({ kind: 'stock', value: match[0] });
  }
  return violations;
}
