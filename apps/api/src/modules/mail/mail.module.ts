import { Module } from '@nestjs/common';
import { MAIL_SENDER, SmtpMailSender } from './mail-sender';

/** Cổng gửi email dùng chung cho job (F05) và OTP. */
@Module({
  providers: [{ provide: MAIL_SENDER, useClass: SmtpMailSender }],
  exports: [MAIL_SENDER],
})
export class MailModule {}
