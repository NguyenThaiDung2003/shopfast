import { Logger } from '@nestjs/common';
import { CategorySource, TicketCategory } from '@prisma/client';
import { categoryAnswer, ScriptedLlmProvider } from '../../../test/scripted-llm.provider';
import { DisabledLlmProvider } from '../llm/disabled.provider';
import { LlmError, LlmProvider } from '../llm/llm.types';
import {
  CLASSIFIER_SYSTEM_PROMPT,
  parseCategory,
  TicketClassifierService,
} from './ticket-classifier.service';
import { TicketsRepository } from './tickets.repository';

const TICKET = {
  id: 'tk-1',
  code: 'TK-000001',
  subject: 'Bị trừ tiền 2 lần',
  firstMessage: 'Tôi thanh toán đơn SF-000010 mà ngân hàng trừ tiền hai lần.',
  category: null,
};

function setup(llm: LlmProvider, ticket: typeof TICKET | null = TICKET) {
  const repository = {
    findForClassification: jest.fn().mockResolvedValue(ticket),
    setCategoryIfUnset: jest.fn().mockResolvedValue(true),
  };
  const service = new TicketClassifierService(repository as unknown as TicketsRepository, llm);
  return { service, repository };
}

beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
afterEach(() => jest.restoreAllMocks());

describe('TicketClassifierService', () => {
  it('nhóm hợp lệ → lưu với nguồn LLM; prompt dùng structured output và bọc ticket là dữ liệu', async () => {
    const llm = new ScriptedLlmProvider([categoryAnswer('THANH_TOAN')]);
    const { service, repository } = setup(llm);

    const result = await service.classify('tk-1', { finalAttempt: false });

    expect(result).toEqual({
      status: 'classified',
      category: TicketCategory.THANH_TOAN,
      source: CategorySource.LLM,
    });
    expect(repository.setCategoryIfUnset).toHaveBeenCalledWith(
      'tk-1',
      TicketCategory.THANH_TOAN,
      CategorySource.LLM,
    );
    const request = llm.requests[0]!;
    expect(request.system).toBe(CLASSIFIER_SYSTEM_PROMPT);
    expect(request.responseSchema?.schema).toMatchObject({
      properties: { category: { enum: Object.values(TicketCategory) } },
    });
    expect(request.messages[0]).toMatchObject({
      role: 'user',
      text: expect.stringMatching(/^<ticket>[\s\S]*trừ tiền hai lần[\s\S]*<\/ticket>$/),
    });
  });

  it('model trả giá trị ngoài 6 nhóm → KHAC (FALLBACK), không thử lại', async () => {
    const { service, repository } = setup(new ScriptedLlmProvider([categoryAnswer('HOAN_TIEN')]));

    const result = await service.classify('tk-1', { finalAttempt: false });

    expect(result).toMatchObject({
      category: TicketCategory.KHAC,
      source: CategorySource.FALLBACK,
    });
    expect(repository.setCategoryIfUnset).toHaveBeenCalledWith(
      'tk-1',
      TicketCategory.KHAC,
      CategorySource.FALLBACK,
    );
  });

  it.each(['timeout', 'rate_limited', 'unavailable'] as const)(
    'lỗi tạm thời %s, chưa phải lần cuối → ném để BullMQ thử lại, không gán gì',
    async (kind) => {
      const error = new LlmError(kind, 'x');
      const { service, repository } = setup(new ScriptedLlmProvider([error]));

      await expect(service.classify('tk-1', { finalAttempt: false })).rejects.toBe(error);
      expect(repository.setCategoryIfUnset).not.toHaveBeenCalled();
    },
  );

  it('lỗi tạm thời ở lần thử cuối → KHAC (ticket không kẹt)', async () => {
    const { service } = setup(new ScriptedLlmProvider([new LlmError('timeout', 'x')]));

    await expect(service.classify('tk-1', { finalAttempt: true })).resolves.toMatchObject({
      category: TicketCategory.KHAC,
      source: CategorySource.FALLBACK,
    });
  });

  it.each(['refused', 'rejected', 'invalid_response'] as const)(
    'lỗi %s (thử lại vô ích) → KHAC ngay',
    async (kind) => {
      const { service } = setup(new ScriptedLlmProvider([new LlmError(kind, 'x')]));

      await expect(service.classify('tk-1', { finalAttempt: false })).resolves.toMatchObject({
        category: TicketCategory.KHAC,
      });
    },
  );

  it('provider tắt (LLM_PROVIDER=disabled) → KHAC ngay, không thử lại', async () => {
    const { service } = setup(new DisabledLlmProvider());

    await expect(service.classify('tk-1', { finalAttempt: false })).resolves.toMatchObject({
      category: TicketCategory.KHAC,
      source: CategorySource.FALLBACK,
    });
  });

  it('ticket đã có nhóm (job chạy lại / nhân viên sửa tay) → bỏ qua, không gọi LLM', async () => {
    const llm = new ScriptedLlmProvider([]);
    const { service, repository } = setup(llm, {
      ...TICKET,
      category: TicketCategory.KHAC as never,
    });

    await expect(service.classify('tk-1', { finalAttempt: false })).resolves.toEqual({
      status: 'skipped',
    });
    expect(llm.requests).toHaveLength(0);
    expect(repository.setCategoryIfUnset).not.toHaveBeenCalled();
  });

  it('ticket không còn → bỏ qua', async () => {
    const { service } = setup(new ScriptedLlmProvider([]), null);
    await expect(service.classify('tk-x', { finalAttempt: false })).resolves.toEqual({
      status: 'skipped',
    });
  });

  it('nhân viên gán tay trong lúc LLM đang chạy → không ghi đè (compare-and-set thua)', async () => {
    const { service, repository } = setup(new ScriptedLlmProvider([categoryAnswer('DON_HANG')]));
    repository.setCategoryIfUnset.mockResolvedValue(false);

    await expect(service.classify('tk-1', { finalAttempt: false })).resolves.toEqual({
      status: 'skipped',
    });
  });
});

describe('parseCategory', () => {
  it.each([
    [{ category: 'VAN_CHUYEN' }, TicketCategory.VAN_CHUYEN],
    [{ category: 'van_chuyen' }, null],
    [{ category: 1 }, null],
    [null, null],
    ['DON_HANG', null],
  ])('%o → %s', (input, expected) => {
    expect(parseCategory(input)).toBe(expected);
  });
});
