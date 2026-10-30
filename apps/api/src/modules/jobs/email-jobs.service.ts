import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@prisma/client';
import { UnrecoverableError } from 'bullmq';
import type { EnvironmentVariables } from '../../config/env.validation';
import { EmailDeliveriesRepository } from './email-deliveries.repository';
import {
  dailyRevenueEmail,
  EmailContent,
  orderConfirmationEmail,
  paymentReminderEmail,
} from './email-templates';
import { JobsRepository, OrderForJob } from './jobs.repository';
import { MAIL_SENDER, MailSender } from './mail-sender';
import { EmailJob, EmailJobName } from './queues';
import { dayRange, reportDate } from './report-period';

export type EmailJobResult =
  { status: 'sent'; sent: number } | { status: 'skipped'; reason: string };

/**
 * Gửi email của các job F05. Mỗi thư đi qua `deliverOnce`: giành quyền trong `email_deliveries`
 * trước khi gửi → chạy lại job (retry, chạy tay, job trùng) không gửi lần hai (ADR-0009).
 */
@Injectable()
export class EmailJobsService {
  private readonly logger = new Logger(EmailJobsService.name);
  private readonly timeZone: string;

  constructor(
    private readonly jobsRepository: JobsRepository,
    private readonly deliveries: EmailDeliveriesRepository,
    @Inject(MAIL_SENDER) private readonly mailSender: MailSender,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.timeZone = config.get('REPORT_TIMEZONE', { infer: true });
  }

  async sendOrderConfirmation(orderId: string): Promise<EmailJobResult> {
    const order = await this.requireOrder(orderId);
    return this.toResult(
      await this.deliverOnce(
        EmailJob.ORDER_CONFIRMATION,
        order.id,
        order.user.email,
        orderConfirmationEmail(order),
      ),
    );
  }

  /** Chạy sau 30 phút: chỉ nhắc khi đơn VẪN chờ thanh toán lúc này. */
  async sendPaymentReminder(orderId: string): Promise<EmailJobResult> {
    const order = await this.requireOrder(orderId);
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      return { status: 'skipped', reason: `status_${order.status}` };
    }
    return this.toResult(
      await this.deliverOnce(
        EmailJob.PAYMENT_REMINDER,
        order.id,
        order.user.email,
        paymentReminderEmail(order),
      ),
    );
  }

  /** Báo cáo doanh thu một ngày cho từng admin; admin đã nhận thì bỏ qua. */
  async sendDailyRevenueReport(date?: string, now = new Date()): Promise<EmailJobResult> {
    const day = reportDate(now, this.timeZone, date);
    const { from, to } = dayRange(day, this.timeZone);
    const [report, admins] = await Promise.all([
      this.jobsRepository.dailyRevenue(from, to),
      this.jobsRepository.findAdmins(),
    ]);
    if (admins.length === 0) return { status: 'skipped', reason: 'no_admin' };

    let sent = 0;
    const failures: string[] = [];
    // Gửi hết cho mọi admin rồi mới báo lỗi: lần thử lại chỉ gửi cho người còn thiếu.
    for (const admin of admins) {
      try {
        const outcome = await this.deliverOnce(
          EmailJob.DAILY_REVENUE_REPORT,
          `${day}:${admin.id}`,
          admin.email,
          dailyRevenueEmail(day, report, admin),
        );
        if (outcome === 'sent') sent++;
      } catch (error) {
        failures.push(`${admin.email}: ${(error as Error).message}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`Daily report ${day} failed for ${failures.join('; ')}`);
    }
    return sent > 0 ? { status: 'sent', sent } : { status: 'skipped', reason: 'already_sent' };
  }

  private async deliverOnce(
    kind: EmailJobName,
    ref: string,
    to: string,
    content: EmailContent,
  ): Promise<'sent' | 'already_sent'> {
    const claimId = await this.deliveries.claim(kind, ref, to);
    if (claimId === null) return 'already_sent';

    try {
      await this.mailSender.send({
        to,
        ...content,
        messageId: `<${kind}.${ref.replace(/[^A-Za-z0-9.-]/g, '.')}@shopfast.local>`,
      });
    } catch (error) {
      // Thư chưa đi: trả claim để lần thử sau gửi được ngay.
      await this.deliveries
        .release(claimId)
        .catch((releaseError: Error) =>
          this.logger.error(`Release claim ${claimId} failed: ${releaseError.message}`),
        );
      throw error;
    }
    // Lỗi ở đây (thư đã đi): claim giữ SENDING, lần thử lại sẽ thấy và bỏ qua.
    await this.deliveries.markSent(claimId);
    return 'sent';
  }

  private toResult(outcome: 'sent' | 'already_sent'): EmailJobResult {
    return outcome === 'sent'
      ? { status: 'sent', sent: 1 }
      : { status: 'skipped', reason: 'already_sent' };
  }

  private async requireOrder(orderId: string): Promise<OrderForJob> {
    const order = await this.jobsRepository.findOrder(orderId);
    // Thử lại cũng vô ích → vào dead-letter ngay.
    if (!order) throw new UnrecoverableError(`Order ${orderId} not found`);
    return order;
  }
}
