// Kênh liên hệ ở đầu trang Hỗ trợ: API không có dữ liệu này nên đọc từ biến VITE_SUPPORT_*.
// Biến nào trống thì ẩn thẻ đó (không hiển thị số/địa chỉ giả).

export interface SupportContact {
  key: 'hotline' | 'chat' | 'email';
  icon: string;
  label: string;
  value: string;
  note?: string;
  href: string;
  /** Mở tab mới (link chat ngoài). */
  external?: boolean;
}

type SupportEnv = Pick<
  ImportMetaEnv,
  | 'VITE_SUPPORT_HOTLINE'
  | 'VITE_SUPPORT_HOTLINE_HOURS'
  | 'VITE_SUPPORT_EMAIL'
  | 'VITE_SUPPORT_CHAT_URL'
  | 'VITE_SUPPORT_CHAT_NAME'
>;

export function supportContacts(env: SupportEnv): SupportContact[] {
  const contacts: SupportContact[] = [];
  const hotline = env.VITE_SUPPORT_HOTLINE?.trim();
  if (hotline) {
    contacts.push({
      key: 'hotline',
      icon: 'call',
      label: 'Tổng đài hỗ trợ',
      value: hotline,
      note: env.VITE_SUPPORT_HOTLINE_HOURS?.trim() || undefined,
      href: `tel:${hotline.replace(/[^\d+]/g, '')}`,
    });
  }
  const chatUrl = env.VITE_SUPPORT_CHAT_URL?.trim();
  if (chatUrl && /^https?:\/\//i.test(chatUrl)) {
    contacts.push({
      key: 'chat',
      icon: 'forum',
      label: 'Chat trực tuyến',
      value: env.VITE_SUPPORT_CHAT_NAME?.trim() || 'Nhắn tin với CSKH',
      href: chatUrl,
      external: true,
    });
  }
  const email = env.VITE_SUPPORT_EMAIL?.trim();
  if (email && email.includes('@')) {
    contacts.push({
      key: 'email',
      icon: 'mail',
      label: 'Hỗ trợ qua email',
      value: email,
      href: `mailto:${email}`,
    });
  }
  return contacts;
}
