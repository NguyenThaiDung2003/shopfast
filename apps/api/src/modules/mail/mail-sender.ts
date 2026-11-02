import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import type { EnvironmentVariables } from '../../config/env.validation';

export const MAIL_SENDER = Symbol('MAIL_SENDER');

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Cố định theo loại email + đối tượng, để hệ thống nhận gộp được thư trùng (ADR-0009). */
  messageId: string;
}

/** Cổng gửi email; test thay bằng bản ghi lại thư thay vì gửi thật. */
export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

/** Gửi qua SMTP (Mailpit ở dev, nhà cung cấp thật ở production – cấu hình bằng env). */
@Injectable()
export class SmtpMailSender implements MailSender {
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly redirectTo?: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const user = config.get('SMTP_USER', { infer: true });
    this.transporter = createTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port: config.get('SMTP_PORT', { infer: true }),
      secure: config.get('SMTP_SECURE', { infer: true }),
      auth: user ? { user, pass: config.get('SMTP_PASSWORD', { infer: true }) } : undefined,
      connectionTimeout: 10_000,
      socketTimeout: 20_000,
    });
    this.from = config.get('MAIL_FROM', { infer: true });
    this.redirectTo = config.get('MAIL_REDIRECT_TO', { infer: true });
  }

  async send({ to, subject, text, messageId }: MailMessage): Promise<void> {
    // Demo: tài khoản mẫu không có hộp thư thật, gom thư về một nơi và giữ lại người nhận gốc.
    const envelope = this.redirectTo
      ? { to: this.redirectTo, subject: `[Gửi cho: ${to}] ${subject}` }
      : { to, subject };
    await this.transporter.sendMail({ from: this.from, ...envelope, text, messageId });
  }
}
