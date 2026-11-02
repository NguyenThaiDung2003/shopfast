import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { MAIL_SENDER, MailSender } from '../mail/mail-sender';
import { OtpPurpose } from './dto/send-otp.dto';

export const OTP_SENDER = Symbol('OTP_SENDER');

export interface OtpMessage {
  email: string;
  purpose: OtpPurpose;
  code: string;
  expiresInSeconds: number;
}

/** Kênh gửi OTP; test thay bằng bản ghi lại mã. */
export interface OtpSender {
  send(message: OtpMessage): Promise<void>;
}

const CONTENT: Record<OtpPurpose, { subject: string; action: string }> = {
  [OtpPurpose.VERIFY_EMAIL]: {
    subject: 'Mã xác minh email ShopFast',
    action: 'xác minh email',
  },
  [OtpPurpose.RESET_PASSWORD]: {
    subject: 'Mã đặt lại mật khẩu ShopFast',
    action: 'đặt lại mật khẩu',
  },
};

/** Gửi thẳng, không qua queue: payload job hiện trên Bull Board sẽ làm lộ mã (ADR-0017). */
@Injectable()
export class MailOtpSender implements OtpSender {
  constructor(@Inject(MAIL_SENDER) private readonly mailSender: MailSender) {}

  async send({ email, purpose, code, expiresInSeconds }: OtpMessage): Promise<void> {
    const { subject, action } = CONTENT[purpose];
    await this.mailSender.send({
      to: email,
      subject,
      text: [
        `Mã ${action} của bạn là: ${code}`,
        `Mã có hiệu lực trong ${Math.ceil(expiresInSeconds / 60)} phút và chỉ dùng được một lần.`,
        'Không chia sẻ mã này cho bất kỳ ai, kể cả nhân viên hỗ trợ.',
        'Nếu bạn không yêu cầu, hãy bỏ qua email này.',
      ].join('\n\n'),
      // Mỗi mã là một thư riêng, không để hệ thống nhận gộp như thư trùng.
      messageId: `<otp.${randomUUID()}@shopfast.local>`,
    });
  }
}
