import { describe, expect, it } from 'vitest';
import { supportContacts } from './support-contacts';
import { categoryLabel, isStaffAuthor, routingNotice } from './ticket-meta';

describe('routingNotice', () => {
  it('chưa có nhóm → đang phân loại', () => {
    expect(routingNotice({ category: null, categorySource: null })).toMatch(/đang đọc nội dung/);
    expect(categoryLabel(null)).toBe('Đang phân loại…');
  });

  it('LLM / STAFF nêu tên nhóm; FALLBACK chuyển bộ phận chung', () => {
    expect(routingNotice({ category: 'VAN_CHUYEN', categorySource: 'LLM' })).toContain(
      'AI phân loại tự động vào nhóm [Vận chuyển & Giao hàng]',
    );
    expect(routingNotice({ category: 'DOI_TRA', categorySource: 'STAFF' })).toContain(
      'Chuyên viên CSKH đã xếp yêu cầu của bạn vào nhóm [Đổi trả]',
    );
    expect(routingNotice({ category: 'KHAC', categorySource: 'FALLBACK' })).toContain(
      'bộ phận CSKH chung',
    );
  });

  it('chỉ khách là người viết phía khách', () => {
    expect(isStaffAuthor('CUSTOMER')).toBe(false);
    expect(isStaffAuthor('SUPPORT')).toBe(true);
    expect(isStaffAuthor('ADMIN')).toBe(true);
  });
});

describe('supportContacts', () => {
  it('biến trống → không có thẻ nào (không hiện số giả)', () => {
    expect(supportContacts({})).toEqual([]);
    expect(supportContacts({ VITE_SUPPORT_HOTLINE: '  ', VITE_SUPPORT_EMAIL: '' })).toEqual([]);
  });

  it('dựng link tel/mailto/chat; bỏ link chat không phải http(s) và email sai', () => {
    const contacts = supportContacts({
      VITE_SUPPORT_HOTLINE: '1900 1234',
      VITE_SUPPORT_HOTLINE_HOURS: '8:00 - 21:00',
      VITE_SUPPORT_EMAIL: 'cskh@shopfast.example',
      VITE_SUPPORT_CHAT_URL: 'https://zalo.me/shopfast',
    });
    expect(contacts.map((c) => [c.key, c.href])).toEqual([
      ['hotline', 'tel:19001234'],
      ['chat', 'https://zalo.me/shopfast'],
      ['email', 'mailto:cskh@shopfast.example'],
    ]);
    expect(contacts[0]!.note).toBe('8:00 - 21:00');

    expect(
      supportContacts({ VITE_SUPPORT_CHAT_URL: 'javascript:alert(1)', VITE_SUPPORT_EMAIL: 'abc' }),
    ).toEqual([]);
  });
});
