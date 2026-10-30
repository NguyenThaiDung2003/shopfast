import Anthropic from '@anthropic-ai/sdk';
import {
  LlmCallOptions,
  LlmError,
  LlmMessage,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmToolCall,
  parseJsonOrNull,
} from './llm.types';

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';

/** Model từ chối vì chính sách → server tự chạy lại trên model dự phòng mặc định. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const DEFAULT_MAX_TOKENS = 16_000;

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  baseURL?: string;
  timeoutMs: number;
}

/** Nội dung gốc của lượt assistant: gửi lại nguyên văn (giữ thinking block) – chỉ cho cùng provider. */
interface AnthropicRaw {
  provider: 'anthropic';
  content: Anthropic.Beta.BetaContentBlock[];
}

type MessagesClient = Pick<Anthropic['beta']['messages'], 'create'>;

/** Claude qua `@anthropic-ai/sdk` (Messages API, tool use, structured output). */
export class AnthropicLlmProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly model: string;
  private readonly messages: MessagesClient;

  constructor(options: AnthropicProviderOptions, client?: MessagesClient) {
    this.model = options.model || ANTHROPIC_DEFAULT_MODEL;
    this.messages =
      client ??
      new Anthropic({
        apiKey: options.apiKey,
        baseURL: options.baseURL || undefined,
        timeout: options.timeoutMs,
        // Một lần thử lại cho lỗi tạm thời; phần còn lại do nơi gọi (queue retry, 503) xử lý.
        maxRetries: 1,
      }).beta.messages;
  }

  async complete(request: LlmRequest, options: LlmCallOptions = {}): Promise<LlmResponse> {
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await this.messages.create(
        {
          model: this.model,
          max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          system: request.system,
          messages: request.messages.map(toAnthropicMessage),
          ...(request.tools?.length && {
            tools: request.tools.map((tool): Anthropic.Beta.BetaTool => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
              strict: true,
            })),
          }),
          output_config: {
            effort: request.effort ?? 'medium',
            ...(request.responseSchema && {
              format: { type: 'json_schema', schema: request.responseSchema.schema },
            }),
          },
        },
        { signal: options.signal },
      );
    } catch (error) {
      throw toLlmError(error);
    }

    if (message.stop_reason === 'refusal') {
      throw new LlmError('refused', `Anthropic refused (${message.stop_details?.category ?? '-'})`);
    }

    const toolCalls: LlmToolCall[] = [];
    const texts: string[] = [];
    for (const block of message.content) {
      if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, input: block.input });
      } else if (block.type === 'text') {
        texts.push(block.text);
      }
    }
    // Bị cắt giữa chừng: input tool có thể dở dang → không được chạy.
    if (message.stop_reason === 'max_tokens') {
      throw new LlmError('invalid_response', 'Anthropic response truncated at max_tokens');
    }

    const text = texts.join('');
    const raw: AnthropicRaw = { provider: 'anthropic', content: message.content };
    return {
      text,
      toolCalls,
      json: request.responseSchema && toolCalls.length === 0 ? parseJsonOrNull(text) : null,
      raw,
    };
  }
}

function toAnthropicMessage(message: LlmMessage): Anthropic.Beta.BetaMessageParam {
  switch (message.role) {
    case 'user':
      return { role: 'user', content: message.text };
    case 'assistant': {
      if (isAnthropicRaw(message.raw)) {
        // Gửi lại đúng nội dung model đã sinh (kể cả thinking block) – không dựng lại.
        return {
          role: 'assistant',
          content: message.raw.content as unknown as Anthropic.Beta.BetaContentBlockParam[],
        };
      }
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (message.text) content.push({ type: 'text', text: message.text });
      for (const call of message.toolCalls) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
      }
      return { role: 'assistant', content };
    }
    case 'tool':
      // Mọi kết quả của một lượt nằm trong MỘT message user.
      return {
        role: 'user',
        content: message.results.map((result) => ({
          type: 'tool_result' as const,
          tool_use_id: result.callId,
          content: result.content,
          ...(result.isError && { is_error: true }),
        })),
      };
  }
}

function isAnthropicRaw(raw: unknown): raw is AnthropicRaw {
  return typeof raw === 'object' && raw !== null && (raw as AnthropicRaw).provider === 'anthropic';
}

/** Lỗi SDK → LlmError theo class có kiểu (không so khớp chuỗi thông điệp). */
export function toLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  // Thứ tự quan trọng: lớp con trước lớp cha.
  if (error instanceof Anthropic.APIUserAbortError) {
    return new LlmError('timeout', 'Anthropic request aborted', error);
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new LlmError('timeout', 'Anthropic request timed out', error);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new LlmError('unavailable', `Anthropic connection error: ${error.message}`, error);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new LlmError('rate_limited', 'Anthropic rate limited', error);
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    const kind = status >= 500 || status === 408 || status === 409 ? 'unavailable' : 'rejected';
    return new LlmError(kind, `Anthropic API error ${status}: ${error.message}`, error);
  }
  return new LlmError('unavailable', `Anthropic call failed: ${String(error)}`, error);
}
