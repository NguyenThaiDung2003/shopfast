// Nhãn/màu của ticket hỗ trợ và câu "Hệ thống điều phối tự động" – logic thuần, không gọi API.

import type { Role } from '../auth/roles';
import type { BadgeTone } from '../components/ui';

export type TicketStatus = 'OPEN' | 'ANSWERED' | 'CLOSED';
export type TicketCategory =
  'DON_HANG' | 'VAN_CHUYEN' | 'THANH_TOAN' | 'DOI_TRA' | 'SAN_PHAM' | 'KHAC';
export type CategorySource = 'LLM' | 'FALLBACK' | 'STAFF';

/** Nơi DUY NHẤT ánh xạ trạng thái ticket → nhãn/màu. */
export const TICKET_STATUS_META: Record<
  TicketStatus,
  { label: string; tone: BadgeTone; hint: string }
> = {
  OPEN: {
    label: 'Đang xử lý',
    tone: 'warning',
    hint: 'Đang chờ chuyên viên CSKH phản hồi',
  },
  ANSWERED: {
    label: 'CSKH đã phản hồi',
    tone: 'primary',
    hint: 'Chuyên viên đã trả lời, đang chờ bạn',
  },
  CLOSED: { label: 'Đã đóng', tone: 'neutral', hint: 'Yêu cầu đã đóng' },
};

export const TICKET_CATEGORY_META: Record<TicketCategory, { label: string; icon: string }> = {
  DON_HANG: { label: 'Đơn hàng', icon: 'shopping_bag' },
  VAN_CHUYEN: { label: 'Vận chuyển & Giao hàng', icon: 'local_shipping' },
  THANH_TOAN: { label: 'Thanh toán & Hoàn tiền', icon: 'payments' },
  DOI_TRA: { label: 'Đổi trả', icon: 'assignment_return' },
  SAN_PHAM: { label: 'Sản phẩm', icon: 'inventory_2' },
  KHAC: { label: 'Khác', icon: 'help' },
};

export function categoryLabel(category: TicketCategory | null): string {
  return category ? TICKET_CATEGORY_META[category].label : 'Đang phân loại…';
}

/** Câu cho banner điều phối, theo ai đã gán nhóm. */
export function routingNotice(ticket: {
  category: TicketCategory | null;
  categorySource: CategorySource | null;
}): string {
  if (!ticket.category) {
    return 'Hệ thống AI đang đọc nội dung để chuyển yêu cầu tới đúng bộ phận. Bạn vẫn có thể nhắn thêm trong lúc chờ.';
  }
  const group = TICKET_CATEGORY_META[ticket.category].label;
  switch (ticket.categorySource) {
    case 'LLM':
      return `Yêu cầu của bạn đã được AI phân loại tự động vào nhóm [${group}] và chuyển tới chuyên viên CSKH phụ trách.`;
    case 'STAFF':
      return `Chuyên viên CSKH đã xếp yêu cầu của bạn vào nhóm [${group}].`;
    default:
      return 'Yêu cầu của bạn đã được chuyển tới bộ phận CSKH chung để xử lý.';
  }
}

/** Tin nhắn của nhân viên (hiện bên trái, kèm "Chuyên viên CSKH"). */
export function isStaffAuthor(role: Role): boolean {
  return role !== 'CUSTOMER';
}
