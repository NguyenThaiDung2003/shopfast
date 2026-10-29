import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/exceptions/app.exception';
import type { EnvironmentVariables } from '../../config/env.validation';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { OTP_SENDER, OtpSender } from './otp-sender';
import { OtpRepository } from './otp.repository';

function hashCode(code: string): Buffer {
  return createHash('sha256').update(code).digest();
}

/**
 * OTP 6 chữ số lưu trong Redis có TTL. Không kiểm tra email có tồn tại hay không
 * để không lộ thông tin tài khoản. Rate limit gửi mã: `@RateLimit('otpSend')` (ADR-0008).
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly ttlSeconds: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly otpRepository: OtpRepository,
    @Inject(OTP_SENDER) private readonly otpSender: OtpSender,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.ttlSeconds = config.get('OTP_TTL_SECONDS', { infer: true });
    this.maxAttempts = config.get('OTP_MAX_ATTEMPTS', { infer: true });
  }

  async send({ email, purpose }: SendOtpDto): Promise<{ expiresInSeconds: number }> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.withRedis(() =>
      this.otpRepository.save(
        this.key(email, purpose),
        hashCode(code).toString('hex'),
        this.ttlSeconds,
      ),
    );
    await this.otpSender.send({ email, purpose, code, expiresInSeconds: this.ttlSeconds });
    return { expiresInSeconds: this.ttlSeconds };
  }

  async verify({ email, purpose, code }: VerifyOtpDto): Promise<{ verified: true }> {
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
    return { verified: true };
  }

  private key(email: string, purpose: string): string {
    return `otp:${purpose}:${email}`;
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

function invalidOtp(): AppException {
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
