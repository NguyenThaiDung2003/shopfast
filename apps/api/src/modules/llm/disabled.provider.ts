import { LlmError, LlmProvider, LlmResponse } from './llm.types';

/** `LLM_PROVIDER=disabled`: không gọi ra ngoài; nơi dùng tự suy giảm (KHAC, 503). */
export class DisabledLlmProvider implements LlmProvider {
  readonly name = 'disabled';

  complete(): Promise<LlmResponse> {
    return Promise.reject(new LlmError('unavailable', 'LLM provider is disabled'));
  }
}
