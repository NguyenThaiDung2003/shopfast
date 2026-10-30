import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import { AnthropicLlmProvider } from './anthropic.provider';
import { DisabledLlmProvider } from './disabled.provider';
import { LLM_PROVIDER, LlmProvider } from './llm.types';
import { GOOGLE_OPENAI_BASE_URL, OpenAiLlmProvider } from './openai.provider';

/** Chọn provider theo `LLM_PROVIDER`; Joi đã bắt buộc khoá/model khi cần (fail-fast). */
export function createLlmProvider(config: ConfigService<EnvironmentVariables, true>): LlmProvider {
  const provider = config.get('LLM_PROVIDER', { infer: true });
  const apiKey = config.get('LLM_API_KEY', { infer: true }) ?? '';
  const model = config.get('LLM_MODEL', { infer: true }) ?? '';
  const baseURL = config.get('LLM_BASE_URL', { infer: true }) || undefined;
  const timeoutMs = config.get('LLM_TIMEOUT_MS', { infer: true });

  switch (provider) {
    case 'anthropic':
      return new AnthropicLlmProvider({ apiKey, model, baseURL, timeoutMs });
    case 'openai':
      return new OpenAiLlmProvider({ apiKey, model, baseURL, timeoutMs });
    case 'google':
      // Gemini qua endpoint tương thích OpenAI của Google AI Studio; cùng adapter với openai.
      return new OpenAiLlmProvider({
        name: 'google',
        apiKey,
        model,
        baseURL: baseURL ?? GOOGLE_OPENAI_BASE_URL,
        timeoutMs,
      });
    case 'disabled':
      new Logger('LlmModule').warn(
        'LLM_PROVIDER=disabled: ticket classification falls back to KHAC, assistant returns 503',
      );
      return new DisabledLlmProvider();
  }
}

@Module({
  providers: [{ provide: LLM_PROVIDER, inject: [ConfigService], useFactory: createLlmProvider }],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
