import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { OtpPurpose } from './dto/send-otp.dto';

export const OTP_SENDER = Symbol('OTP_SENDER');

export interface OtpMessage {
  email: string;
  purpose: OtpPurpose;
  code: string;
  expiresInSeconds: number;
}

/** Kênh gửi OTP. Bản hiện tại giả lập; sau này thay bằng email/SMS provider. */
export interface OtpSender {
  send(message: OtpMessage): Promise<void>;
}

@Injectable()
export class LogOtpSender implements OtpSender {
  private readonly logger = new Logger('OtpSender');
  private readonly revealCode: boolean;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.revealCode = config.get('NODE_ENV', { infer: true }) !== 'production';
  }

  async send({ email, purpose, code, expiresInSeconds }: OtpMessage): Promise<void> {
    // Không bao giờ ghi mã OTP vào log ở production.
    const shown = this.revealCode ? code : '******';
    this.logger.log(
      `[GIẢ LẬP] Gửi OTP ${purpose} tới ${email}: ${shown} (hết hạn ${expiresInSeconds}s)`,
    );
  }
}
