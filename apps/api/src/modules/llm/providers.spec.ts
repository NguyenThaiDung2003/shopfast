import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { ANTHROPIC_DEFAULT_MODEL, AnthropicLlmProvider, toLlmError } from './anthropic.provider';
import { envValidationSchema } from '../../config/env.validation';
import { DisabledLlmProvider } from './disabled.provider';
import { createLlmProvider } from './llm.module';
import { LlmError, LlmRequest } from './llm.types';
import { OpenAiLlmProvider, toLlmError as toOpenAiLlmError } from './openai.provider';

const tools = [
  {
    name: 'getOrderStatus',
    description: 'Tra đơn',
    inputSchema: {
      type: 'object',
      properties: { orderRef: { type: 'string' } },
      required: ['orderRef'],
      additionalProperties: false,
    },
  },
];
const responseSchema = {
  name: 'reply',
  schema: { type: 'object', properties: {}, additionalProperties: false },
};

function anthropicMessage(
  overrides: Partial<Anthropic.Beta.BetaMessage>,
): Anthropic.Beta.BetaMessage {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: ANTHROPIC_DEFAULT_MODEL,
    content: [],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    ...overrides,
  } as unknown as Anthropic.Beta.BetaMessage;
}

describe('AnthropicLlmProvider', () => {
  const setup = (message: Anthropic.Beta.BetaMessage) => {
    const create = jest.fn().mockResolvedValue(message);
    const provider = new AnthropicLlmProvider({ apiKey: 'k', timeoutMs: 1000 }, {
      create,
    } as never);
    return { provider, create };
  };

  it('dựng request: model mặc định, tool strict, structured output, fallback, signal', async () => {
    const { provider, create } = setup(anthropicMessage({ content: [] }));
    const signal = new AbortController().signal;

    await provider.complete(
      {
        system: 'sys',
        messages: [{ role: 'user', text: 'hi' }],
        tools,
        responseSchema,
        effort: 'low',
      },
      { signal },
    );

    const [body, options] = create.mock.calls[0] as [
      Record<string, unknown>,
      { signal: AbortSignal },
    ];
    expect(body).toMatchObject({
      model: ANTHROPIC_DEFAULT_MODEL,
      system: 'sys',
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'getOrderStatus', strict: true, input_schema: tools[0]!.inputSchema }],
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: responseSchema.schema },
      },
    });
    expect(options.signal).toBe(signal);
  });

  it('tool_use → toolCalls; raw được gửi lại nguyên văn ở lượt sau; tool result trong một message', async () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'tool_use', id: 'tu_1', name: 'getOrderStatus', input: { orderRef: 'SF-000001' } },
    ];
    const { provider, create } = setup(
      anthropicMessage({ content: content as never, stop_reason: 'tool_use' }),
    );

    const first = await provider.complete({
      system: 's',
      messages: [{ role: 'user', text: 'q' }],
      tools,
    });
    expect(first.toolCalls).toEqual([
      { id: 'tu_1', name: 'getOrderStatus', input: { orderRef: 'SF-000001' } },
    ]);
    expect(first.json).toBeNull();

    const request: LlmRequest = {
      system: 's',
      messages: [
        { role: 'user', text: 'q' },
        { role: 'assistant', text: '', toolCalls: first.toolCalls, raw: first.raw },
        {
          role: 'tool',
          results: [
            { callId: 'tu_1', content: '{"ok":1}' },
            { callId: 'tu_2', content: 'x', isError: true },
          ],
        },
      ],
    };
    await provider.complete(request);
    const body = create.mock.calls[1]![0] as { messages: unknown[] };
    expect(body.messages[1]).toEqual({ role: 'assistant', content });
    expect(body.messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tu_1', content: '{"ok":1}' },
        { type: 'tool_result', tool_use_id: 'tu_2', content: 'x', is_error: true },
      ],
    });
  });

  it('lượt assistant từ provider khác (không có raw) được dựng lại từ text + tool calls', async () => {
    const { provider, create } = setup(anthropicMessage({}));
    await provider.complete({
      system: 's',
      messages: [
        { role: 'user', text: 'q' },
        {
          role: 'assistant',
          text: 'ok',
          toolCalls: [{ id: 'c1', name: 'checkStock', input: { sku: 'A' } }],
        },
      ],
    });
    const body = create.mock.calls[0]![0] as { messages: unknown[] };
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'ok' },
        { type: 'tool_use', id: 'c1', name: 'checkStock', input: { sku: 'A' } },
      ],
    });
  });

  it('text JSON + responseSchema → json đã parse', async () => {
    const { provider } = setup(
      anthropicMessage({
        content: [{ type: 'text', text: '{"kind":"answer","reply":"x"}' }] as never,
      }),
    );
    const response = await provider.complete({ system: 's', messages: [], responseSchema });
    expect(response.json).toEqual({ kind: 'answer', reply: 'x' });
  });

  it('refusal → LlmError refused; max_tokens → invalid_response', async () => {
    await expect(
      setup(anthropicMessage({ stop_reason: 'refusal' as never })).provider.complete({
        system: 's',
        messages: [],
      }),
    ).rejects.toMatchObject({ kind: 'refused' });
    await expect(
      setup(anthropicMessage({ stop_reason: 'max_tokens' })).provider.complete({
        system: 's',
        messages: [],
      }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('lỗi SDK → LlmError theo class có kiểu', () => {
    const headers = new Headers();
    expect(toLlmError(new Anthropic.APIUserAbortError()).kind).toBe('timeout');
    expect(toLlmError(new Anthropic.APIConnectionTimeoutError()).kind).toBe('timeout');
    expect(toLlmError(new Anthropic.APIConnectionError({ message: 'x' })).kind).toBe('unavailable');
    expect(toLlmError(new Anthropic.RateLimitError(429, {}, 'x', headers)).kind).toBe(
      'rate_limited',
    );
    expect(toLlmError(new Anthropic.InternalServerError(500, {}, 'x', headers)).kind).toBe(
      'unavailable',
    );
    expect(toLlmError(new Anthropic.AuthenticationError(401, {}, 'x', headers)).kind).toBe(
      'rejected',
    );
    expect(toLlmError(new Error('boom')).kind).toBe('unavailable');
  });

  it('lỗi trong create được chuẩn hoá', async () => {
    const provider = new AnthropicLlmProvider({ apiKey: 'k', timeoutMs: 1 }, {
      create: jest.fn().mockRejectedValue(new Anthropic.APIConnectionTimeoutError()),
    } as never);
    await expect(provider.complete({ system: 's', messages: [] })).rejects.toBeInstanceOf(LlmError);
  });
});

describe('OpenAiLlmProvider', () => {
  const completion = (message: Record<string, unknown>, finish_reason = 'stop') => ({
    id: 'c',
    object: 'chat.completion',
    created: 0,
    model: 'm',
    choices: [
      {
        index: 0,
        finish_reason,
        logprobs: null,
        message: { role: 'assistant', refusal: null, ...message },
      },
    ],
  });
  const setup = (result: unknown) => {
    const create = jest.fn().mockResolvedValue(result);
    const provider = new OpenAiLlmProvider(
      { apiKey: 'k', model: 'm', timeoutMs: 1000 },
      { create },
    );
    return { provider, create };
  };

  it('dựng request: system, tool function strict, response_format json_schema', async () => {
    const { provider, create } = setup(completion({ content: '{}' }));
    await provider.complete({
      system: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
      tools,
      responseSchema,
    });

    expect(create.mock.calls[0]![0]).toMatchObject({
      model: 'm',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      tools: [{ type: 'function', function: { name: 'getOrderStatus', strict: true } }],
      response_format: { type: 'json_schema', json_schema: { name: 'reply', strict: true } },
    });
  });

  it('tool_calls → parse JSON arguments; arguments hỏng giữ nguyên chuỗi', async () => {
    const { provider } = setup(
      completion(
        {
          content: null,
          tool_calls: [
            {
              id: 't1',
              type: 'function',
              function: { name: 'checkStock', arguments: '{"sku":"A"}' },
            },
            { id: 't2', type: 'function', function: { name: 'checkStock', arguments: '{bad' } },
          ],
        },
        'tool_calls',
      ),
    );
    const response = await provider.complete({ system: 's', messages: [], tools });
    expect(response.toolCalls).toEqual([
      { id: 't1', name: 'checkStock', input: { sku: 'A' } },
      { id: 't2', name: 'checkStock', input: '{bad' },
    ]);
  });

  it('tool_calls gốc (thought_signature của Gemini) được gửi lại nguyên văn cho cùng provider', async () => {
    const rawCall = {
      id: 'g1',
      type: 'function',
      function: { name: 'getOrderStatus', arguments: '{"orderRef":"SF-000001"}' },
      extra_content: { google: { thought_signature: 'sig-abc' } },
    };
    const create = jest
      .fn()
      .mockResolvedValueOnce(completion({ content: null, tool_calls: [rawCall] }, 'tool_calls'))
      .mockResolvedValue(completion({ content: 'ok' }));
    const google = new OpenAiLlmProvider(
      { name: 'google', apiKey: 'k', model: 'gemini', timeoutMs: 1000 },
      { create },
    );

    const first = await google.complete({
      system: 's',
      messages: [{ role: 'user', text: 'q' }],
      tools,
    });
    await google.complete({
      system: 's',
      messages: [
        { role: 'user', text: 'q' },
        { role: 'assistant', text: first.text, toolCalls: first.toolCalls, raw: first.raw },
        { role: 'tool', results: [{ callId: 'g1', content: '{}' }] },
      ],
    });

    const body = create.mock.calls[1]![0] as { messages: Array<{ tool_calls?: unknown[] }> };
    expect(body.messages[2]!.tool_calls).toEqual([rawCall]);
  });

  it('raw của provider khác → dựng lại tool_calls từ dữ liệu trung lập', async () => {
    const { provider, create } = setup(completion({ content: 'ok' }));
    await provider.complete({
      system: 's',
      messages: [
        {
          role: 'assistant',
          text: '',
          toolCalls: [{ id: 'c1', name: 'checkStock', input: { sku: 'A' } }],
          raw: { provider: 'google', toolCalls: [{ id: 'x', extra_content: {} }] },
        },
      ],
    });
    const body = create.mock.calls[0]![0] as { messages: Array<{ tool_calls?: unknown[] }> };
    expect(body.messages[1]!.tool_calls).toEqual([
      { id: 'c1', type: 'function', function: { name: 'checkStock', arguments: '{"sku":"A"}' } },
    ]);
  });

  it('lịch sử: assistant tool_calls + tool messages (lỗi ghi rõ trong nội dung)', async () => {
    const { provider, create } = setup(completion({ content: 'ok' }));
    await provider.complete({
      system: 's',
      messages: [
        {
          role: 'assistant',
          text: '',
          toolCalls: [{ id: 't1', name: 'checkStock', input: { sku: 'A' } }],
        },
        { role: 'tool', results: [{ callId: 't1', content: '{"e":1}', isError: true }] },
      ],
    });
    const body = create.mock.calls[0]![0] as { messages: unknown[] };
    expect(body.messages.slice(1)).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 't1',
            type: 'function',
            function: { name: 'checkStock', arguments: '{"sku":"A"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 't1', content: 'ERROR: {"e":1}' },
    ]);
  });

  it('refusal / content_filter → refused; length → invalid_response; không có choice → invalid_response', async () => {
    const run = (result: unknown) => setup(result).provider.complete({ system: 's', messages: [] });
    await expect(run(completion({ content: null, refusal: 'no' }))).rejects.toMatchObject({
      kind: 'refused',
    });
    await expect(run(completion({ content: '' }, 'content_filter'))).rejects.toMatchObject({
      kind: 'refused',
    });
    await expect(run(completion({ content: '{"a' }, 'length'))).rejects.toMatchObject({
      kind: 'invalid_response',
    });
    await expect(run({ choices: [] })).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('lỗi SDK → LlmError theo class có kiểu', () => {
    const headers = new Headers();
    expect(toOpenAiLlmError(new OpenAI.APIUserAbortError()).kind).toBe('timeout');
    expect(toOpenAiLlmError(new OpenAI.APIConnectionTimeoutError()).kind).toBe('timeout');
    expect(toOpenAiLlmError(new OpenAI.RateLimitError(429, {}, 'x', headers)).kind).toBe(
      'rate_limited',
    );
    // Hết credit cũng là 429 nhưng không tạm thời → rejected, job phân loại không thử lại.
    const quota = toOpenAiLlmError(
      new OpenAI.RateLimitError(
        429,
        { code: 'credit_balance_exhausted', type: 'insufficient_quota' },
        'x',
        headers,
      ),
    );
    expect(quota).toMatchObject({ kind: 'rejected', retryable: false });
    expect(quota.message).toContain('credit_balance_exhausted');
    expect(toOpenAiLlmError(new OpenAI.BadRequestError(400, {}, 'x', headers)).kind).toBe(
      'rejected',
    );
    expect(toOpenAiLlmError(new OpenAI.InternalServerError(503, {}, 'x', headers)).kind).toBe(
      'unavailable',
    );
  });
});

describe('DisabledLlmProvider', () => {
  it('luôn ném unavailable', async () => {
    await expect(new DisabledLlmProvider().complete()).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
});

describe('createLlmProvider + env validation', () => {
  const configFor = (env: Record<string, string>) => {
    const { value, error } = envValidationSchema.validate(
      {
        DATABASE_URL: 'postgresql://u:p@h/db',
        REDIS_URL: 'redis://h',
        JWT_SECRET: 'x'.repeat(32),
        ...env,
      },
      { abortEarly: false, allowUnknown: true },
    );
    return { error, config: { get: (key: string) => value[key] } as never };
  };

  it('google → adapter tương thích OpenAI, endpoint Google, tên "google"', () => {
    const { error, config } = configFor({
      LLM_PROVIDER: 'google',
      LLM_API_KEY: 'k',
      LLM_MODEL: 'gemini-x',
    });
    expect(error).toBeUndefined();
    const provider = createLlmProvider(config);
    expect(provider).toBeInstanceOf(OpenAiLlmProvider);
    expect(provider.name).toBe('google');
  });

  it.each([
    [{ LLM_PROVIDER: 'google', LLM_API_KEY: 'k' }, 'LLM_MODEL'],
    [{ LLM_PROVIDER: 'openai', LLM_API_KEY: 'k' }, 'LLM_MODEL'],
    [{ LLM_PROVIDER: 'anthropic' }, 'LLM_API_KEY'],
    [{ LLM_PROVIDER: 'gemini', LLM_API_KEY: 'k' }, 'LLM_PROVIDER'],
  ])('%o thiếu/sai → fail-fast ở %s', (env, key) => {
    expect(configFor(env).error?.message).toContain(key);
  });

  it('anthropic không cần LLM_MODEL; disabled không cần khoá', () => {
    expect(configFor({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k' }).error).toBeUndefined();
    const { error, config } = configFor({});
    expect(error).toBeUndefined();
    expect(createLlmProvider(config)).toBeInstanceOf(DisabledLlmProvider);
  });
});
