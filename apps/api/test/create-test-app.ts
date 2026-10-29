import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OTP_SENDER, OtpMessage, OtpSender } from '../src/modules/auth/otp-sender';

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

export async function createTestApp(
  options: {
    beforeInit?: (app: INestApplication) => void;
    /** Thay provider thật, ví dụ trỏ REDIS_CLIENT vào Redis "chết". */
    override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
  } = {},
): Promise<{
  app: INestApplication;
  otpSender: CapturingOtpSender;
}> {
  const otpSender = new CapturingOtpSender();
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OTP_SENDER)
    .useValue(otpSender);
  const moduleRef = await (options.override?.(builder) ?? builder).compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  options.beforeInit?.(app);
  await app.init();
  return { app, otpSender };
}
