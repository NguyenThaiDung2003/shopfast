import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@prisma/client';
import type { EnvironmentVariables } from '../../config/env.validation';
import { EmailDeliveriesRepository } from './email-deliveries.repository';
import { EmailClaimBusyError, EmailJobsService } from './email-jobs.service';
import { DailyRevenue, JobsRepository, OrderForJob } from './jobs.repository';
import { MailSender } from './mail-sender';

const order: OrderForJob = {
  id: '6f1d0c8e-0000-4000-8000-000000000001',
  code: 'SF-000123',
  status: OrderStatus.PENDING_PAYMENT,
  totalAmount: 2_500_000,
  paidAt: null,
  createdAt: new Date('2026-10-29T03:00:00Z'),
  user: { email: 'khach@shopfast.local', fullName: 'Trần Bình' },
  items: [{ quantity: 2, unitPrice: 1_250_000, product: { sku: 'SKU-1', name: 'Tai nghe' } }],
};

const report: DailyRevenue = {
  revenue: 5_000_000,
  paidOrders: 2,
  newOrders: 3,
  cancelledOrders: 1,
  topProducts: [{ sku: 'SKU-1', name: 'Tai nghe', quantity: 4, revenue: 5_000_000 }],
};

const admins = [
  { id: 'a1', email: 'admin1@shopfast.local', fullName: 'Admin Một' },
  { id: 'a2', email: 'admin2@shopfast.local', fullName: 'Admin Hai' },
];

describe('EmailJobsService', () => {
  let jobs: jest.Mocked<Pick<JobsRepository, 'findOrder' | 'findAdmins' | 'dailyRevenue'>>;
  let deliveries: jest.Mocked<Pick<EmailDeliveriesRepository, 'claim' | 'markSent' | 'release'>>;
  let mail: jest.Mocked<MailSender>;
  let service: EmailJobsService;

  beforeEach(() => {
    jobs = {
      findOrder: jest.fn().mockResolvedValue(order),
      findAdmins: jest.fn().mockResolvedValue(admins),
      dailyRevenue: jest.fn().mockResolvedValue(report),
    };
    let nextId = 1;
    deliveries = {
      claim: jest.fn().mockImplementation(async () => ({ status: 'claimed', id: nextId++ })),
      markSent: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    mail = { send: jest.fn().mockResolvedValue(undefined) };
    const config = {
      get: () => 'Asia/Ho_Chi_Minh',
    } as unknown as ConfigService<EnvironmentVariables, true>;
    service = new EmailJobsService(
      jobs as unknown as JobsRepository,
      deliveries as unknown as EmailDeliveriesRepository,
      mail,
      config,
    );
  });

  describe('xác nhận đơn', () => {
    it('giành được claim → gửi một thư tiếng Việt rồi đánh dấu SENT', async () => {
      await expect(service.sendOrderConfirmation(order.id)).resolves.toEqual({
        status: 'sent',
        sent: 1,
      });

      expect(deliveries.claim).toHaveBeenCalledWith(
        'order-confirmation',
        order.id,
        order.user.email,
      );
      expect(mail.send).toHaveBeenCalledTimes(1);
      expect(mail.send.mock.calls[0]![0]).toMatchObject({
        to: order.user.email,
        subject: '[ShopFast] Xác nhận đơn hàng SF-000123',
        messageId: `<order-confirmation.${order.id}@shopfast.local>`,
      });
      expect(mail.send.mock.calls[0]![0].text).toContain('Tai nghe (SKU-1) × 2');
      expect(deliveries.markSent).toHaveBeenCalledWith(1);
    });

    it('đã gửi trước đó (claim thua) → không gửi lại', async () => {
      deliveries.claim.mockResolvedValue({ status: 'sent' });

      await expect(service.sendOrderConfirmation(order.id)).resolves.toEqual({
        status: 'skipped',
        reason: 'already_sent',
      });
      expect(mail.send).not.toHaveBeenCalled();
      expect(deliveries.markSent).not.toHaveBeenCalled();
    });

    it('claim của lần chạy khác còn hiệu lực → chờ, không báo đã gửi (worker chết giữa chừng)', async () => {
      deliveries.claim.mockResolvedValueOnce({ status: 'busy', retryAfterMs: 540_000 });

      await expect(service.sendOrderConfirmation(order.id)).rejects.toMatchObject({
        name: 'EmailClaimBusyError',
        retryAfterMs: 540_000,
      });

      expect(mail.send).not.toHaveBeenCalled();
      expect(deliveries.markSent).not.toHaveBeenCalled();
    });

    it('SMTP lỗi → trả claim để lần thử sau gửi được, rồi ném lỗi cho BullMQ retry', async () => {
      mail.send.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.sendOrderConfirmation(order.id)).rejects.toThrow('ECONNREFUSED');
      expect(deliveries.release).toHaveBeenCalledWith(1);
      expect(deliveries.markSent).not.toHaveBeenCalled();
    });

    it('trả claim cũng lỗi → vẫn ném lỗi gửi thư gốc, có log', async () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      mail.send.mockRejectedValue(new Error('ECONNREFUSED'));
      deliveries.release.mockRejectedValue(new Error('db down'));

      await expect(service.sendOrderConfirmation(order.id)).rejects.toThrow('ECONNREFUSED');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('db down'));
      error.mockRestore();
    });

    it('đơn không tồn tại → UnrecoverableError (vào dead-letter ngay, không thử lại)', async () => {
      jobs.findOrder.mockResolvedValue(null);

      await expect(service.sendOrderConfirmation('khong-co')).rejects.toMatchObject({
        name: 'UnrecoverableError',
      });
    });
  });

  describe('nhắc thanh toán', () => {
    it('đơn vẫn PENDING_PAYMENT → gửi nhắc', async () => {
      await expect(service.sendPaymentReminder(order.id)).resolves.toMatchObject({
        status: 'sent',
      });
      expect(deliveries.claim).toHaveBeenCalledWith('payment-reminder', order.id, order.user.email);
    });

    it.each([OrderStatus.PAID, OrderStatus.CANCELLED])(
      'đơn đã %s lúc job chạy → bỏ qua, không gửi',
      async (status) => {
        jobs.findOrder.mockResolvedValue({ ...order, status });

        await expect(service.sendPaymentReminder(order.id)).resolves.toEqual({
          status: 'skipped',
          reason: `status_${status}`,
        });
        expect(deliveries.claim).not.toHaveBeenCalled();
        expect(mail.send).not.toHaveBeenCalled();
      },
    );
  });

  describe('báo cáo doanh thu ngày', () => {
    it('mặc định là hôm qua theo giờ VN; khoảng [00:00, 24:00) +07; gửi từng admin', async () => {
      // 2026-10-30 00:00:05 giờ VN.
      const now = new Date('2026-10-29T17:00:05Z');

      await expect(service.sendDailyRevenueReport(undefined, now)).resolves.toEqual({
        status: 'sent',
        sent: 2,
      });

      expect(jobs.dailyRevenue).toHaveBeenCalledWith(
        new Date('2026-10-28T17:00:00Z'),
        new Date('2026-10-29T17:00:00Z'),
      );
      expect(deliveries.claim.mock.calls.map((c) => c[1])).toEqual([
        '2026-10-29:a1',
        '2026-10-29:a2',
      ]);
      const sent = mail.send.mock.calls[0]![0];
      expect(sent.subject).toBe('[ShopFast] Báo cáo doanh thu ngày 2026-10-29');
      expect(sent.text).toContain('Số đơn đã thanh toán: 2');
      // ":" không hợp lệ trong Message-ID.
      expect(sent.messageId).toBe('<daily-revenue-report.2026-10-29.a1@shopfast.local>');
    });

    it('admin đã nhận → chỉ gửi cho admin còn thiếu', async () => {
      deliveries.claim
        .mockResolvedValueOnce({ status: 'sent' })
        .mockResolvedValueOnce({ status: 'claimed', id: 7 });

      await expect(service.sendDailyRevenueReport('2026-10-29')).resolves.toEqual({
        status: 'sent',
        sent: 1,
      });
      expect(mail.send).toHaveBeenCalledTimes(1);
      expect(mail.send.mock.calls[0]![0].to).toBe('admin2@shopfast.local');
    });

    it('mọi admin đã nhận → skipped', async () => {
      deliveries.claim.mockResolvedValue({ status: 'sent' });

      await expect(service.sendDailyRevenueReport('2026-10-29')).resolves.toEqual({
        status: 'skipped',
        reason: 'already_sent',
      });
    });

    it('một admin lỗi → vẫn gửi người còn lại rồi ném để retry', async () => {
      mail.send.mockRejectedValueOnce(new Error('mailbox full'));

      await expect(service.sendDailyRevenueReport('2026-10-29')).rejects.toThrow(
        'admin1@shopfast.local: mailbox full',
      );
      expect(mail.send).toHaveBeenCalledTimes(2);
      expect(deliveries.markSent).toHaveBeenCalledTimes(1);
    });

    it('một admin bị giữ claim → vẫn gửi người còn lại rồi chờ theo claim lâu nhất', async () => {
      deliveries.claim
        .mockResolvedValueOnce({ status: 'busy', retryAfterMs: 1_000 })
        .mockResolvedValueOnce({ status: 'claimed', id: 9 });

      await expect(service.sendDailyRevenueReport()).rejects.toBeInstanceOf(EmailClaimBusyError);

      expect(mail.send).toHaveBeenCalledTimes(1);
      expect(deliveries.markSent).toHaveBeenCalledWith(9);
    });

    it('không có admin → skipped', async () => {
      jobs.findAdmins.mockResolvedValue([]);

      await expect(service.sendDailyRevenueReport('2026-10-29')).resolves.toEqual({
        status: 'skipped',
        reason: 'no_admin',
      });
    });
  });
});
