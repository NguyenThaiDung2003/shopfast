import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions';
import {
  LlmCallOptions,
  LlmError,
  LlmMessage,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmToolCall,
  parseJsonOrNull,
  parseToolArguments,
} from './llm.types';

/** Gemini (Google AI Studio) qua lớp tương thích OpenAI của Google. */
export const GOOGLE_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

export interface OpenAiProviderOptions {
  /** Tên provider trong log: `openai` hoặc `google` (cùng adapter, khác endpoint). */
  name?: string;
  apiKey: string;
  model: string;
  baseURL?: string;
  timeoutMs: number;
}

type CompletionsClient = {
  create(
    body: ChatCompletionCreateParamsNonStreaming,
    options?: { signal?: AbortSignal },
  ): PromiseLike<ChatCompletion>;
};

/**
 * OpenAI qua SDK `openai`, Chat Completions. Cũng dùng cho mọi dịch vụ tương thích OpenAI
 * (LLM_BASE_URL), trong đó có Gemini của Google AI Studio (`LLM_PROVIDER=google`).
 */
export class OpenAiLlmProvider implements LlmProvider {
  readonly name: string;
  private readonly model: string;
  private readonly completions: CompletionsClient;

  constructor(options: OpenAiProviderOptions, client?: CompletionsClient) {
    this.name = options.name ?? 'openai';
    this.model = options.model;
    this.completions =
      client ??
      new OpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseURL || undefined,
        timeout: options.timeoutMs,
        maxRetries: 1,
      }).chat.completions;
  }

  async complete(request: LlmRequest, options: LlmCallOptions = {}): Promise<LlmResponse> {
    let completion: ChatCompletion;
    try {
      completion = await this.completions.create(
        {
          model: this.model,
          max_completion_tokens: request.maxOutputTokens ?? 4_000,
          messages: [
            { role: 'system', content: request.system },
            ...request.messages.flatMap((m) => toOpenAiMessages(m, this.name)),
          ],
          ...(request.tools?.length && {
            tools: request.tools.map((tool) => ({
              type: 'function' as const,
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
                strict: true,
              },
            })),
          }),
          ...(request.responseSchema && {
            response_format: {
              type: 'json_schema' as const,
              json_schema: {
                name: request.responseSchema.name,
                schema: request.responseSchema.schema,
                strict: true,
              },
            },
          }),
        },
        { signal: options.signal },
      );
    } catch (error) {
      throw toLlmError(error, this.name);
    }

    const choice = completion.choices[0];
    if (!choice) throw new LlmError('invalid_response', 'OpenAI returned no choices');
    if (choice.message.refusal) {
      throw new LlmError('refused', 'OpenAI refused the request');
    }
    if (choice.finish_reason === 'length') {
      throw new LlmError('invalid_response', 'OpenAI response truncated (length)');
    }
    if (choice.finish_reason === 'content_filter') {
      throw new LlmError('refused', 'OpenAI content filter');
    }

    const toolCalls: LlmToolCall[] = (choice.message.tool_calls ?? []).flatMap((call) =>
      call.type === 'function'
        ? [
            {
              id: call.id,
              name: call.function.name,
              input: parseToolArguments(call.function.arguments),
            },
          ]
        : [],
    );
    const text = choice.message.content ?? '';
    const raw: OpenAiRaw = { provider: this.name, toolCalls: choice.message.tool_calls ?? [] };
    return {
      text,
      toolCalls,
      json: request.responseSchema && toolCalls.length === 0 ? parseJsonOrNull(text) : null,
      raw,
    };
  }
}

/**
 * tool_calls gốc của lượt assistant. Gửi lại NGUYÊN VĂN cho cùng provider: Gemini 3 gắn
 * `extra_content.google.thought_signature` vào từng tool call và trả 400 nếu lượt sau thiếu nó.
 */
interface OpenAiRaw {
  provider: string;
  toolCalls: unknown[];
}

function isRawFrom(raw: unknown, provider: string): raw is OpenAiRaw {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as OpenAiRaw).provider === provider &&
    Array.isArray((raw as OpenAiRaw).toolCalls)
  );
}

function toOpenAiMessages(message: LlmMessage, provider: string): ChatCompletionMessageParam[] {
  switch (message.role) {
    case 'user':
      return [{ role: 'user', content: message.text }];
    case 'assistant':
      if (isRawFrom(message.raw, provider) && message.raw.toolCalls.length > 0) {
        return [
          {
            role: 'assistant',
            content: message.text || null,
            tool_calls: message.raw.toolCalls as ChatCompletionMessageToolCall[],
          },
        ];
      }
      return [
        {
          role: 'assistant',
          content: message.text || null,
          ...(message.toolCalls.length > 0 && {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: 'function' as const,
              function: {
                name: call.name,
                arguments: typeof call.input === 'string' ? call.input : JSON.stringify(call.input),
              },
            })),
          }),
        },
      ];
    case 'tool':
      // OpenAI không có cờ lỗi cho tool result: ghi rõ trong nội dung.
      return message.results.map((result) => ({
        role: 'tool' as const,
        tool_call_id: result.callId,
        content: result.isError ? `ERROR: ${result.content}` : result.content,
      }));
  }
}

export function toLlmError(error: unknown, provider = 'openai'): LlmError {
  if (error instanceof LlmError) return error;
  if (error instanceof OpenAI.APIUserAbortError) {
    return new LlmError('timeout', `${provider} request aborted`, error);
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new LlmError('timeout', `${provider} request timed out`, error);
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new LlmError('unavailable', `${provider} connection error: ${error.message}`, error);
  }
  if (error instanceof OpenAI.RateLimitError) {
    // 429 cũng dùng cho "hết credit/hạn mức" – đợi bao lâu cũng không hết, thử lại vô ích.
    if (error.type === 'insufficient_quota' || error.code === 'insufficient_quota') {
      return new LlmError(
        'rejected',
        `${provider} quota exhausted (${error.code ?? error.type})`,
        error,
      );
    }
    return new LlmError('rate_limited', `${provider} rate limited (${error.code ?? '-'})`, error);
  }
  if (error instanceof OpenAI.APIError) {
    const status = error.status ?? 0;
    const kind = status >= 500 || status === 408 || status === 409 ? 'unavailable' : 'rejected';
    return new LlmError(kind, `${provider} API error ${status}: ${error.message}`, error);
  }
  return new LlmError('unavailable', `${provider} call failed: ${String(error)}`, error);
}
