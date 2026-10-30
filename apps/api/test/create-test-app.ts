import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import type Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { REDIS_CLIENT } from '../src/database/redis.constants';
import { OTP_SENDER, OtpMessage, OtpSender } from '../src/modules/auth/otp-sender';
import { MAIL_SENDER, MailMessage, MailSender } from '../src/modules/jobs/mail-sender';

/** Bắt lại OTP thay vì "gửi", để test đọc được mã. */
export class CapturingOtpSender implements OtpSender {
  readonly sent: OtpMessage[] = [];

  async send(message: OtpMessage): Promise<void> {
    this.sent.push(message);
  }

  lastCodeFor(email: string): string | undefined {
    return [...this.sent].reverse().find((m) => m.email === email)?.code;
  }
}

/** Ghi lại email của job F05 thay vì gửi SMTP. */
export class CapturingMailSender implements MailSender {
  readonly sent: MailMessage[] = [];
  /** Giả lập SMTP chậm. */
  delayMs = 0;

  async send(message: MailMessage): Promise<void> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    this.sent.push(message);
  }

  to(email: string): MailMessage[] {
    return this.sent.filter((m) => m.to === email);
  }
}

export async function createTestApp(
  options: {
    beforeInit?: (app: INestApplication) => void;
    /** Thay provider thật, ví dụ trỏ REDIS_CLIENT vào Redis "chết". */
    override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
  } = {},
): Promise<{
  app: INestApplication;
  otpSender: CapturingOtpSender;
  mailSender: CapturingMailSender;
}> {
  const otpSender = new CapturingOtpSender();
  const mailSender = new CapturingMailSender();
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OTP_SENDER)
    .useValue(otpSender)
    .overrideProvider(MAIL_SENDER)
    .useValue(mailSender);
  const moduleRef = await (options.override?.(builder) ?? builder).compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  options.beforeInit?.(app);
  await app.init();
  await waitForRedis(app.get<Redis>(REDIS_CLIENT));
  return { app, otpSender, mailSender };
}

/**
 * REDIS_CLIENT kết nối lười và fail-fast: lệnh gửi trước khi kết nối xong bị từ chối ngay (cache,
 * rate limit cho qua) và làm test ngẫu nhiên sai. Chờ tối đa 2 giây – client cố ý hỏng thì thôi.
 */
async function waitForRedis(redis: Redis, timeoutMs = 2_000): Promise<void> {
  if (redis.status === 'ready') return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    redis.once('ready', done);
    function done(): void {
      clearTimeout(timer);
      redis.off('ready', done);
      resolve();
    }
  });
}
