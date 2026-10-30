import type {
  LlmCallOptions,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmToolCall,
} from '../src/modules/llm/llm.types';

/** Một lượt trả lời trong kịch bản: response cố định, lỗi để ném, hoặc hàm tự quyết theo request. */
export type ScriptStep =
  | LlmResponse
  | Error
  | ((request: LlmRequest, options: LlmCallOptions) => LlmResponse | Promise<LlmResponse>);

/**
 * LLM giả cho test (không gọi mạng): trả lần lượt theo kịch bản và ghi lại mọi request để test
 * kiểm system prompt, tool, kết quả tool gửi lại. Hết kịch bản → ném lỗi (test viết thiếu bước).
 */
export class ScriptedLlmProvider implements LlmProvider {
  readonly name = 'scripted';
  readonly requests: LlmRequest[] = [];
  private steps: ScriptStep[] = [];

  constructor(steps: ScriptStep[] = []) {
    this.steps = [...steps];
  }

  /** Thay kịch bản (e2e dùng một provider cho cả app, đặt lại trước mỗi test). */
  script(...steps: ScriptStep[]): this {
    this.steps = [...steps];
    this.requests.length = 0;
    return this;
  }

  async complete(request: LlmRequest, options: LlmCallOptions = {}): Promise<LlmResponse> {
    this.requests.push(structuredClone(request));
    const step = this.steps.shift();
    if (step === undefined) throw new Error('ScriptedLlmProvider: script exhausted');
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step(request, options) : step;
  }

  /** Kết quả tool mà agent đã gửi lại cho model ở request thứ `index`. */
  toolResultsAt(index: number): Array<{ callId: string; content: string; isError?: boolean }> {
    const messages = this.requests[index]?.messages ?? [];
    const last = messages.at(-1);
    return last?.role === 'tool' ? last.results : [];
  }
}

let callSeq = 0;

/** Model yêu cầu gọi tool. */
export function toolCalls(...calls: Array<{ name: string; input: unknown }>): LlmResponse {
  const withIds: LlmToolCall[] = calls.map((c) => ({ id: `call_${++callSeq}`, ...c }));
  return { text: '', toolCalls: withIds, json: null };
}

/** Câu trả lời cuối theo FINAL_ANSWER_SCHEMA. */
export function finalAnswer(kind: 'answer' | 'out_of_scope', reply: string): LlmResponse {
  const json = { kind, reply };
  return { text: JSON.stringify(json), toolCalls: [], json };
}

/** Output phân loại theo schema của TicketClassifierService. */
export function categoryAnswer(category: string): LlmResponse {
  const json = { category };
  return { text: JSON.stringify(json), toolCalls: [], json };
}

/** Model "treo" tới khi bị huỷ bằng signal – hoặc mãi mãi nếu bỏ qua signal. */
export function hang(respectSignal = false): ScriptStep {
  return (_request, options) =>
    new Promise<LlmResponse>((_, reject) => {
      if (respectSignal) {
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }
    });
}
