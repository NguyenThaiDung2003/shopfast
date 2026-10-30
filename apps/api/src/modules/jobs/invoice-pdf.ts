import PDFDocument from 'pdfkit';
import { formatVnd } from './email-templates';
import type { OrderForJob } from './jobs.repository';

// Helvetica mặc định của PDFKit không có chữ tiếng Việt có dấu.
const FONT_REGULAR = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const FONT_BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');

const dateTime = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Ho_Chi_Minh',
});

/** Hoá đơn PDF của một đơn đã thanh toán. */
export function renderInvoicePdf(order: OrderForJob): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Cố định ngày tạo trong metadata: chạy lại cho ra cùng nội dung.
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: { Title: `Hoá đơn ${order.code}`, CreationDate: order.paidAt ?? order.createdAt },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font(FONT_BOLD).fontSize(20).text('ShopFast – Hoá đơn bán hàng');
    doc.moveDown(0.5).font(FONT_REGULAR).fontSize(11);
    doc.text(`Mã đơn: ${order.code}`);
    doc.text(`Khách hàng: ${order.user.fullName} <${order.user.email}>`);
    doc.text(`Ngày đặt: ${dateTime.format(order.createdAt)}`);
    if (order.paidAt) doc.text(`Ngày thanh toán: ${dateTime.format(order.paidAt)}`);
    doc.moveDown();

    doc.font(FONT_BOLD).text('Sản phẩm');
    doc.font(FONT_REGULAR);
    for (const item of order.items) {
      doc.text(
        `${item.product.name} (${item.product.sku}) – ${item.quantity} × ${formatVnd(item.unitPrice)} = ${formatVnd(item.quantity * item.unitPrice)}`,
      );
    }
    doc.moveDown();
    doc
      .font(FONT_BOLD)
      .fontSize(13)
      .text(`Tổng cộng: ${formatVnd(order.totalAmount)}`);
    doc.end();
  });
}
