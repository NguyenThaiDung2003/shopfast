import type { AdminRecipient, DailyRevenue, OrderForJob } from './jobs.repository';

export interface EmailContent {
  subject: string;
  text: string;
}

const vnd = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });
export const formatVnd = (amount: number) => vnd.format(amount);

function itemLines(order: OrderForJob): string {
  return order.items
    .map(
      (item) =>
        `- ${item.product.name} (${item.product.sku}) × ${item.quantity}: ${formatVnd(item.quantity * item.unitPrice)}`,
    )
    .join('\n');
}

export function orderConfirmationEmail(order: OrderForJob): EmailContent {
  return {
    subject: `[ShopFast] Xác nhận đơn hàng ${order.code}`,
    text: [
      `Xin chào ${order.user.fullName},`,
      '',
      `Cảm ơn bạn đã đặt hàng tại ShopFast. Đơn ${order.code} đã được ghi nhận:`,
      '',
      itemLines(order),
      '',
      `Tổng cộng: ${formatVnd(order.totalAmount)}`,
      '',
      'Vui lòng thanh toán trong 30 phút để chúng tôi giữ hàng cho bạn.',
    ].join('\n'),
  };
}

export function paymentReminderEmail(order: OrderForJob): EmailContent {
  return {
    subject: `[ShopFast] Đơn ${order.code} đang chờ thanh toán`,
    text: [
      `Xin chào ${order.user.fullName},`,
      '',
      `Đơn ${order.code} (${formatVnd(order.totalAmount)}) vẫn chưa được thanh toán.`,
      'Bạn vui lòng hoàn tất thanh toán để đơn được xử lý sớm nhất.',
    ].join('\n'),
  };
}

export function dailyRevenueEmail(
  date: string,
  report: DailyRevenue,
  admin: AdminRecipient,
): EmailContent {
  const top =
    report.topProducts.length === 0
      ? '(không có)'
      : report.topProducts
          .map(
            (p, i) => `${i + 1}. ${p.name} (${p.sku}): ${p.quantity} sp – ${formatVnd(p.revenue)}`,
          )
          .join('\n');
  return {
    subject: `[ShopFast] Báo cáo doanh thu ngày ${date}`,
    text: [
      `Xin chào ${admin.fullName},`,
      '',
      `Báo cáo ngày ${date}:`,
      `- Doanh thu (đơn đã thanh toán, trừ đơn huỷ): ${formatVnd(report.revenue)}`,
      `- Số đơn đã thanh toán: ${report.paidOrders}`,
      `- Số đơn mới: ${report.newOrders}`,
      `- Số đơn bị huỷ: ${report.cancelledOrders}`,
      '',
      'Sản phẩm bán chạy:',
      top,
    ].join('\n'),
  };
}
