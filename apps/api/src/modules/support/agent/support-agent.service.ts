import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../../common/exceptions/app.exception';
import type { EnvironmentVariables } from '../../../config/env.validation';
import type { AuthUser } from '../../auth/auth.types';
import {
  LLM_PROVIDER,
  LlmError,
  LlmMessage,
  LlmProvider,
  LlmResponse,
  LlmToolResult,
} from '../../llm/llm.types';
import {
  AssistantOutcome,
  AssistantReplyDto,
  AssistantToolCallDto,
} from '../dto/assistant-reply.response';
import { PendingActionDto } from '../dto/pending-action.response';
import { TicketDetailDto } from '../dto/ticket.response';
import { TicketsService } from '../tickets.service';
import { AGENT_TOOLS, AgentToolsService, ToolContext } from './agent-tools';
import { findUngroundedClaims } from './grounding';
import {
  GROUNDING_CORRECTION,
  LIMIT_REACHED_REPLY,
  SUPPORT_AGENT_SYSTEM_PROMPT,
  UNGROUNDED_REPLY,
} from './system-prompt';

export const FINAL_ANSWER_SCHEMA = {
  name: 'assistant_reply',
  schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['answer', 'out_of_scope'] },
      reply: { type: 'string' },
    },
    required: ['kind', 'reply'],
    additionalProperties: false,
  },
};

/** Số tin nhắn gần nhất của ticket đưa vào ngữ cảnh. */
const CONTEXT_MESSAGES = 10;
const CONTEXT_MESSAGE_CHARS = 1_000;

export const AI_UNAVAILABLE_MESSAGE =
  'Trợ lý AI tạm thời không khả dụng, vui lòng thử lại sau hoặc xử lý ticket thủ công.';

interface FinalAnswer {
  kind: 'answer' | 'out_of_scope';
  reply: string;
}

/** Câu trả lời cuối: JSON theo schema; model trả text thường thì coi là câu trả lời. */
export function parseFinalAnswer(response: LlmResponse): FinalAnswer {
  const json = response.json as Partial<FinalAnswer> | null;
  if (
    json &&
    (json.kind === 'answer' || json.kind === 'out_of_scope') &&
    typeof json.reply === 'string' &&
    json.reply.trim()
  ) {
    return { kind: json.kind, reply: json.reply.trim() };
  }
  return { kind: 'answer', reply: response.text.trim() };
}

/** Ticket → khối ngữ cảnh. Nội dung khách viết được đánh dấu rõ là dữ liệu. */
export function buildTicketContext(ticket: TicketDetailDto): string {
  const messages = ticket.messages
    .slice(-CONTEXT_MESSAGES)
    .map(
      (m) =>
        `[${m.author.role === 'CUSTOMER' ? 'Khách' : `Nhân viên ${m.author.fullName}`}] ${m.body.slice(0, CONTEXT_MESSAGE_CHARS)}`,
    )
    .join('\n');
  return [
    '<ticket_context>',
    `Mã ticket: ${ticket.code}`,
    `Tiêu đề: ${ticket.subject}`,
    `Nhóm: ${ticket.category ?? 'chưa phân loại'}`,
    `Đơn liên quan: ${ticket.orderCode ?? 'không có'}`,
    'Tin nhắn (cũ → mới):',
    messages,
    '</ticket_context>',
  ].join('\n');
}

/**
 * Trợ lý AI cho nhân viên hỗ trợ (F06, ADR-0011): vòng lặp tool calling có giới hạn số vòng,
 * deadline cho cả lượt, kiểm grounding bằng code. Lỗi LLM → 503 tiếng Việt, không làm sập API.
 */
@Injectable()
export class SupportAgentService {
  private readonly logger = new Logger(SupportAgentService.name);
  private readonly maxRounds: number;
  private readonly timeoutMs: number;

  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly tools: AgentToolsService,
    private readonly ticketsService: TicketsService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.maxRounds = config.get('AGENT_MAX_TOOL_ROUNDS', { infer: true });
    this.timeoutMs = config.get('AGENT_TIMEOUT_MS', { infer: true });
  }

  async ask(staff: AuthUser, ticketId: string, question: string): Promise<AssistantReplyDto> {
    const ticket = await this.ticketsService.findOne(staff, ticketId);
    const context = buildTicketContext(ticket);
    const toolContext: ToolContext = { staff, ticketId: ticket.id };

    const toolCalls: AssistantToolCallDto[] = [];
    const pendingActions: PendingActionDto[] = [];
    const toolOutputs: string[] = [];
    const succeededTools = new Set<string>();
    const messages: LlmMessage[] = [
      { role: 'user', text: `${context}\n\nCâu hỏi của nhân viên: ${question}` },
    ];
    const result = (outcome: AssistantOutcome, reply: string): AssistantReplyDto => ({
      outcome,
      reply,
      toolCalls,
      pendingActions,
    });

    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), this.timeoutMs);
    let corrected = false;
    try {
      for (let round = 1; round <= this.maxRounds; round++) {
        const response = await this.callModel(messages, deadline.signal);

        if (response.toolCalls.length > 0) {
          messages.push({
            role: 'assistant',
            text: response.text,
            toolCalls: response.toolCalls,
            raw: response.raw,
          });
          // Chạy song song, trả MỌI kết quả trong một lượt; lỗi tool là dữ liệu cho model.
          const executions = await Promise.all(
            response.toolCalls.map((call) => this.tools.execute(call, toolContext)),
          );
          const results: LlmToolResult[] = response.toolCalls.map((call, i) => {
            const execution = executions[i]!;
            toolCalls.push({ name: call.name, input: call.input, ok: execution.ok });
            if (execution.ok) {
              succeededTools.add(call.name);
              toolOutputs.push(execution.content);
            }
            // Đề xuất trùng trả lại bản đang chờ: chỉ liệt kê một lần.
            const action = execution.pendingAction;
            if (action && !pendingActions.some((a) => a.id === action.id)) {
              pendingActions.push(action);
            }
            return { callId: call.id, content: execution.content, isError: !execution.ok };
          });
          messages.push({ role: 'tool', results });
          continue;
        }

        const answer = parseFinalAnswer(response);
        if (answer.kind === 'out_of_scope') return result('out_of_scope', answer.reply);

        const violations = findUngroundedClaims(answer.reply, {
          toolOutputs,
          succeededTools,
          context: `${context}\n${question}`,
        });
        if (violations.length === 0 && answer.reply) return result('answered', answer.reply);

        this.logger.warn(
          `Ungrounded assistant reply for ticket ${ticket.code}: ${violations.map((v) => `${v.kind}=${v.value}`).join(', ') || 'empty reply'}`,
        );
        if (corrected || round === this.maxRounds) return result('ungrounded', UNGROUNDED_REPLY);
        // Nhắc một lần (tính vào số vòng): tra bằng tool hoặc bỏ thông tin chưa kiểm.
        corrected = true;
        messages.push(
          { role: 'assistant', text: response.text, toolCalls: [], raw: response.raw },
          { role: 'user', text: GROUNDING_CORRECTION },
        );
      }
      return result('limit_reached', LIMIT_REACHED_REPLY);
    } catch (error) {
      if (!(error instanceof LlmError)) throw error;
      this.logger.warn(
        `Assistant unavailable for ticket ${ticket.code} (${this.llm.name}, ${error.kind}): ${error.message}`,
      );
      // Đề xuất đã tạo trước khi lỗi vẫn còn (PENDING) – báo lại để nhân viên không mất dấu.
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'AI_UNAVAILABLE',
        AI_UNAVAILABLE_MESSAGE,
        {
          pendingActionIds: pendingActions.map((a) => a.id),
        },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Gọi model, hết deadline thì dừng ngay kể cả khi provider không tôn trọng AbortSignal
   * (race với signal) – request HTTP của nhân viên không bao giờ treo quá AGENT_TIMEOUT_MS.
   */
  private callModel(messages: LlmMessage[], signal: AbortSignal): Promise<LlmResponse> {
    if (signal.aborted) {
      return Promise.reject(new LlmError('timeout', 'Assistant deadline exceeded'));
    }
    let onAbort: () => void = () => undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new LlmError('timeout', 'Assistant deadline exceeded'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    return Promise.race([
      this.llm.complete(
        {
          system: SUPPORT_AGENT_SYSTEM_PROMPT,
          // Bản sao: model/adapter không được sửa lịch sử của vòng lặp.
          messages: [...messages],
          tools: AGENT_TOOLS,
          responseSchema: FINAL_ANSWER_SCHEMA,
          effort: 'medium',
        },
        { signal },
      ),
      aborted,
    ]).finally(() => signal.removeEventListener('abort', onAbort));
  }
}
