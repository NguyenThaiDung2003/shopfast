import { describe, expect, it } from 'vitest';
import { initials, toolCallLabel, toolIcon } from './assistant-view';
import {
  parseQueueFilters,
  queueTabCount,
  toQueueSearchParams,
  validateDecisionNote,
  validateQuestion,
  validateQueueSearch,
} from './console-filters';

const ID = '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607';
const parse = (qs: string) => parseQueueFilters(new URLSearchParams(qs));

describe('parseQueueFilters / toQueueSearchParams', () => {
  it('mặc định: tab "Chờ xử lý", không lọc nhóm', () => {
    expect(parse('')).toEqual({
      tab: 'open',
      category: undefined,
      q: undefined,
      page: 1,
      ticket: undefined,
    });
    expect(toQueueSearchParams(parse('')).toString()).toBe('');
  });

  it('đọc đủ tham số và ghi lại y nguyên', () => {
    const filters = parse(`status=closed&category=VAN_CHUYEN&q=%20minh%20&page=2&ticket=${ID}`);
    expect(filters).toEqual({
      tab: 'closed',
      category: 'VAN_CHUYEN',
      q: 'minh',
      page: 2,
      ticket: ID,
    });
    expect(toQueueSearchParams(filters).toString()).toBe(
      `status=closed&category=VAN_CHUYEN&q=minh&page=2&ticket=${ID}`,
    );
  });

  it('bỏ giá trị sai (kể cả khoá kế thừa như "toString")', () => {
    expect(parse('status=x&category=toString&page=0&ticket=TK-1')).toEqual({
      tab: 'open',
      category: undefined,
      q: undefined,
      page: 1,
      ticket: undefined,
    });
  });

  it('số trên tab: theo trạng thái, "Tất cả" = tổng', () => {
    const counts = { OPEN: 5, ANSWERED: 2, CLOSED: 9 };
    expect(queueTabCount('open', counts)).toBe(5);
    expect(queueTabCount('all', counts)).toBe(16);
    expect(queueTabCount('all', undefined)).toBeUndefined();
  });
});

describe('validate', () => {
  it('tìm kiếm ≤ 100 ký tự; câu hỏi 1–2000; ghi chú ≤ 500', () => {
    expect(validateQueueSearch(' ')).toEqual({ q: undefined });
    expect(validateQueueSearch('a'.repeat(101)).error).toBe('Từ khoá tối đa 100 ký tự.');
    expect(validateQuestion('  ')).toBe('Vui lòng nhập câu hỏi cho Copilot.');
    expect(validateQuestion('a'.repeat(2001))).toBe('Câu hỏi tối đa 2.000 ký tự.');
    expect(validateQuestion('Đơn này sao rồi?')).toBeUndefined();
    expect(validateDecisionNote('')).toBeUndefined();
    expect(validateDecisionNote('a'.repeat(501))).toBe('Ghi chú tối đa 500 ký tự.');
  });
});

describe('assistant-view', () => {
  it('chip tool call: nhãn tiếng Việt + tham số chính; lỗi gắn "– lỗi"; tool lạ dùng tên gốc', () => {
    expect(
      toolCallLabel({ name: 'getOrderStatus', input: { orderRef: 'SF-000123' }, ok: true }),
    ).toBe('Tra cứu trạng thái đơn: SF-000123');
    expect(toolCallLabel({ name: 'checkStock', input: { sku: 'SF-DT-0001' }, ok: false })).toBe(
      'Kiểm tra tồn kho: SF-DT-0001 – lỗi',
    );
    expect(toolCallLabel({ name: 'proposeCancelOrder', input: null, ok: true })).toBe(
      'Đề xuất huỷ đơn',
    );
    expect(toolCallLabel({ name: 'lookupWeather', input: { city: 'HN' }, ok: true })).toBe(
      'lookupWeather',
    );
    expect(toolIcon({ name: 'lookupWeather', input: {}, ok: true })).toBe('build');
  });

  it('chữ cái đầu cho avatar', () => {
    expect(initials('Nguyễn Văn Minh')).toBe('NM');
    expect(initials('  linh ')).toBe('L');
    expect(initials('')).toBe('?');
  });
});
