import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/exceptions/app.exception';
import type { EnvironmentVariables } from '../../config/env.validation';
import { UsersRepository } from '../users/users.repository';
import { OtpPurpose, SendOtpDto } from './dto/send-otp.dto';
import { OTP_SENDER, OtpSender } from './otp-sender';
import { OtpRepository } from './otp.repository';

/** Khớp `RESEND_SECONDS` của web. */
const RESEND_COOLDOWN_SECONDS = 30;

function hashCode(code: string): Buffer {
  return createHash('sha256').update(code).digest();
}

/**
 * OTP 6 chữ số lưu trong Redis có TTL. Phản hồi như nhau dù email có tài khoản hay không để không
 * lộ thông tin; chỉ tài khoản đủ điều kiện mới nhận thư. Rate limit: ADR-0008, luồng: ADR-0017.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly ttlSeconds: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly otpRepository: OtpRepository,
    private readonly usersRepository: UsersRepository,
    @Inject(OTP_SENDER) private readonly otpSender: OtpSender,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.ttlSeconds = config.get('OTP_TTL_SECONDS', { infer: true });
    this.maxAttempts = config.get('OTP_MAX_ATTEMPTS', { infer: true });
  }

  async send({ email, purpose }: SendOtpDto): Promise<{ expiresInSeconds: number }> {
    const result = { expiresInSeconds: this.ttlSeconds };
    const key = this.key(email, purpose);
    const claimed = await this.withRedis(() =>
      this.otpRepository.claimCooldown(`${key}:cooldown`, RESEND_COOLDOWN_SECONDS),
    );
    // Mã cũ vẫn dùng được; gửi lại dồn dập không làm đầy hộp thư của người khác.
    if (!claimed) return result;

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.withRedis(() =>
      this.otpRepository.save(key, hashCode(code).toString('hex'), this.ttlSeconds),
    );
    if (await this.canReceive(email, purpose)) {
      // Không chờ SMTP: thời gian phản hồi không được cho biết email có tài khoản hay không.
      void this.otpSender
        .send({ email, purpose, code, expiresInSeconds: this.ttlSeconds })
        .catch((error: Error) => this.logger.error(`OTP mail failed: ${error.message}`));
    }
    return result;
  }

  /** Kiểm và huỷ mã (dùng một lần); sai thì ném lỗi. */
  async consume(email: string, purpose: OtpPurpose, code: string): Promise<void> {
    const key = this.key(email, purpose);
    const stored = await this.withRedis(() => this.otpRepository.find(key));
    if (!stored) throw invalidOtp();

    if (stored.attempts >= this.maxAttempts) {
      await this.withRedis(() => this.otpRepository.delete(key));
      throw tooManyAttempts();
    }

    const matches = timingSafeEqual(hashCode(code), Buffer.from(stored.codeHash, 'hex'));
    if (!matches) {
      const attempts = await this.withRedis(() => this.otpRepository.incrementAttempts(key));
      if (attempts >= this.maxAttempts) {
        await this.withRedis(() => this.otpRepository.delete(key));
        throw tooManyAttempts();
      }
      throw invalidOtp();
    }

    // Mã chỉ dùng được một lần.
    await this.withRedis(() => this.otpRepository.delete(key));
  }

  private async canReceive(email: string, purpose: OtpPurpose): Promise<boolean> {
    const status = await this.usersRepository.findEmailStatus(email);
    if (!status) return false;
    return purpose === OtpPurpose.RESET_PASSWORD || status.emailVerifiedAt === null;
  }

  private key(email: string, purpose: string): string {
    // Redis không chứa email thô, như LoginAttemptsRepository.
    return `otp:${purpose}:${createHash('sha256').update(email).digest('hex')}`;
  }

  /** Redis lỗi → 503 tiếng Việt; phần còn lại của API (đăng nhập, sản phẩm) vẫn chạy. */
  private async withRedis<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.logger.error(`Redis unavailable for OTP: ${(error as Error).message}`);
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SERVICE_UNAVAILABLE',
        'Dịch vụ gửi mã xác thực đang tạm gián đoạn, vui lòng thử lại sau.',
      );
    }
  }
}

export function invalidOtp(): AppException {
  return new AppException(
    HttpStatus.BAD_REQUEST,
    'OTP_INVALID',
    'Mã xác thực không đúng hoặc đã hết hạn.',
  );
}

function tooManyAttempts(): AppException {
  return new AppException(
    HttpStatus.TOO_MANY_REQUESTS,
    'OTP_TOO_MANY_ATTEMPTS',
    'Bạn đã nhập sai quá nhiều lần, vui lòng yêu cầu mã mới.',
  );
}
