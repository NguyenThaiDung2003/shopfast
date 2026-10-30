import { describe, expect, it } from 'vitest';
import {
  parseTicketFilters,
  ticketTabCount,
  toTicketSearchParams,
  validateNewTicket,
  validateReply,
  validateTicketSearch,
} from './my-tickets-filters';

const ID = '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607';
const parse = (qs: string) => parseTicketFilters(new URLSearchParams(qs));

describe('parseTicketFilters / toTicketSearchParams', () => {
  it('mặc định: tab Tất cả, trang 1, không từ khoá, chưa mở ticket', () => {
    expect(parse('')).toEqual({ tab: 'all', q: undefined, page: 1, ticket: undefined });
  });

  it('đọc đủ tham số và ghi lại y nguyên', () => {
    const filters = parse(`tab=open&q=%20giao%20&page=3&ticket=${ID}`);
    expect(filters).toEqual({ tab: 'open', q: 'giao', page: 3, ticket: ID });
    expect(toTicketSearchParams(filters).toString()).toBe(`tab=open&q=giao&page=3&ticket=${ID}`);
  });

  it('bỏ giá trị sai: tab lạ, trang âm/chữ/quá lớn, ticket không phải UUID', () => {
    expect(parse('tab=foo&page=-1&ticket=TK-000001')).toEqual({
      tab: 'all',
      q: undefined,
      page: 1,
      ticket: undefined,
    });
    expect(parse('page=abc').page).toBe(1);
    expect(parse('page=1001').page).toBe(1);
  });

  it('bỏ giá trị mặc định khỏi URL', () => {
    expect(toTicketSearchParams({ tab: 'all', page: 1 }).toString()).toBe('');
  });
});

describe('ticketTabCount', () => {
  const counts = { OPEN: 2, ANSWERED: 1, CLOSED: 4 };
  it('"Đang xử lý" = OPEN + ANSWERED, "Tất cả" = tổng', () => {
    expect(ticketTabCount('open', counts)).toBe(3);
    expect(ticketTabCount('closed', counts)).toBe(4);
    expect(ticketTabCount('all', counts)).toBe(7);
    expect(ticketTabCount('all', undefined)).toBeUndefined();
  });
});

describe('validate', () => {
  it('ô tìm kiếm: rỗng bỏ lọc, quá 100 ký tự báo lỗi', () => {
    expect(validateTicketSearch('  ')).toEqual({ q: undefined });
    expect(validateTicketSearch(' TK-1 ')).toEqual({ q: 'TK-1' });
    expect(validateTicketSearch('a'.repeat(101)).error).toBe('Từ khoá tối đa 100 ký tự.');
  });

  it('form tạo ticket: bắt buộc tiêu đề + nội dung (tính sau khi trim), giới hạn độ dài', () => {
    expect(validateNewTicket({ subject: '   ', message: '' })).toEqual({
      subject: 'Vui lòng nhập tiêu đề yêu cầu.',
      message: 'Vui lòng mô tả vấn đề bạn gặp phải.',
    });
    expect(validateNewTicket({ subject: 'a'.repeat(201), message: 'b'.repeat(5001) })).toEqual({
      subject: 'Tiêu đề tối đa 200 ký tự.',
      message: 'Nội dung tối đa 5.000 ký tự.',
    });
    expect(validateNewTicket({ subject: ` ${'a'.repeat(200)} `, message: 'ok' })).toEqual({});
  });

  it('tin nhắn trả lời: 1–5000 ký tự sau khi trim', () => {
    expect(validateReply(' \n ')).toBe('Vui lòng nhập nội dung tin nhắn.');
    expect(validateReply('b'.repeat(5001))).toBe('Tin nhắn tối đa 5.000 ký tự.');
    expect(validateReply('Cảm ơn')).toBeUndefined();
  });
});
