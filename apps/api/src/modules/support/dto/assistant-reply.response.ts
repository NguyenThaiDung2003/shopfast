import { ApiProperty } from '@nestjs/swagger';
import { PendingActionDto } from './pending-action.response';

export const ASSISTANT_OUTCOMES = [
  'answered',
  'out_of_scope',
  'limit_reached',
  'ungrounded',
] as const;
export type AssistantOutcome = (typeof ASSISTANT_OUTCOMES)[number];

export class AssistantToolCallDto {
  /** Tên tool trợ lý đã gọi. */
  name!: string;
  /** Input trợ lý truyền vào tool. */
  input!: unknown;
  /** Tool chạy thành công (true) hay trả lỗi cho trợ lý (false). */
  ok!: boolean;
}

export class AssistantReplyDto {
  @ApiProperty({
    description:
      'answered: trả lời bình thường; out_of_scope: câu hỏi ngoài phạm vi ShopFast; ' +
      'limit_reached: hết số vòng gọi tool; ungrounded: câu trả lời nêu thông tin đơn/tồn kho ' +
      'chưa tra bằng tool nên bị chặn.',
    enum: ASSISTANT_OUTCOMES,
  })
  outcome!: AssistantOutcome;
  /** Câu trả lời cho nhân viên. */
  reply!: string;
  /** Các tool trợ lý đã gọi trong lượt này, theo thứ tự. */
  toolCalls!: AssistantToolCallDto[];
  /** Thao tác ghi trợ lý đã đề xuất – CHƯA thực thi, chờ nhân viên xác nhận. */
  pendingActions!: PendingActionDto[];
}
