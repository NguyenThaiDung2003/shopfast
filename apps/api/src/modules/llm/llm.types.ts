/**
 * Giao diện trung lập với nhà cung cấp LLM (F06, ADR-0011). Code nghiệp vụ chỉ dùng các kiểu
 * này; adapter (`anthropic.provider.ts`, `openai.provider.ts`) ánh xạ sang SDK tương ứng.
 */

/** Token inject provider đang cấu hình (`LLM_PROVIDER`). Test thay bằng bản giả có kịch bản. */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/** JSON Schema (con) đủ dùng cho tool và structured output; mọi object phải có `additionalProperties: false`. */
export type JsonSchema = Record<string, unknown>;

export interface LlmToolSpec {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface LlmToolCall {
  id: string;
  name: string;
  /** Input model đề xuất – CHƯA được kiểm, nơi chạy tool phải tự validate. */
  input: unknown;
}

export interface LlmToolResult {
  callId: string;
  /** Kết quả dạng chuỗi (thường là JSON). */
  content: string;
  isError?: boolean;
}

export type LlmMessage =
  | { role: 'user'; text: string }
  | {
      role: 'assistant';
      text: string;
      toolCalls: LlmToolCall[];
      /** Nội dung gốc của provider; adapter cùng loại gửi lại nguyên văn (thinking block…). */
      raw?: unknown;
    }
  | { role: 'tool'; results: LlmToolResult[] };

/** Mức "suy nghĩ": việc đơn giản (phân loại) dùng `low`, agent dùng `medium`. */
export type LlmEffort = 'low' | 'medium' | 'high';

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  tools?: LlmToolSpec[];
  /** Có thì câu trả lời cuối (khi không gọi tool) phải là JSON theo schema này. */
  responseSchema?: { name: string; schema: JsonSchema };
  effort?: LlmEffort;
  maxOutputTokens?: number;
}

export interface LlmResponse {
  text: string;
  toolCalls: LlmToolCall[];
  /** JSON đã parse khi có `responseSchema` và model không gọi tool; null nếu không parse được. */
  json: unknown;
  raw?: unknown;
}

export interface LlmCallOptions {
  /** Huỷ khi hết thời gian của cả lượt (AGENT_TIMEOUT_MS). */
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly name: string;
  complete(request: LlmRequest, options?: LlmCallOptions): Promise<LlmResponse>;
}

export type LlmErrorKind =
  /** Hết thời gian chờ (một lời gọi hoặc cả lượt). */
  | 'timeout'
  | 'rate_limited'
  /** Provider tắt, lỗi mạng, 5xx – không có kết quả, thử lại sau có thể được. */
  | 'unavailable'
  /** Provider từ chối request (khoá sai, model không tồn tại, 4xx) – thử lại vô ích. */
  | 'rejected'
  /** Model từ chối vì chính sách an toàn. */
  | 'refused'
  /** Có phản hồi nhưng không dùng được (bị cắt, sai định dạng). */
  | 'invalid_response';

/** Lỗi đã chuẩn hoá từ mọi provider. `message` chỉ dùng cho log nội bộ, không trả cho client. */
export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmError';
  }

  /** Lỗi tạm thời: thử lại sau có thể thành công. */
  get retryable(): boolean {
    return this.kind === 'timeout' || this.kind === 'rate_limited' || this.kind === 'unavailable';
  }
}

/** Parse JSON từ text của model; trả null nếu không phải JSON hợp lệ. */
export function parseJsonOrNull(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

/** Tool call input của OpenAI là chuỗi JSON; input hỏng giữ nguyên chuỗi để nơi chạy tool báo lỗi. */
export function parseToolArguments(raw: string): unknown {
  const parsed = parseJsonOrNull(raw);
  return parsed ?? raw;
}
