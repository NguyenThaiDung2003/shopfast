import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { PublicUser, toPublicUser, UsersRepository } from '../users/users.repository';
import type { AuthResult, AuthTokens, ClientContext } from './auth.types';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { OtpPurpose } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginAttemptsService } from './login-attempts.service';
import { invalidOtp, OtpService } from './otp.service';
import { PasswordHasher } from './password-hasher';
import { TokenService } from './token.service';

function invalidCredentials(): AppException {
  // Cùng một thông điệp cho "email không tồn tại" và "sai mật khẩu".
  return new AppException(
    HttpStatus.UNAUTHORIZED,
    'INVALID_CREDENTIALS',
    'Email hoặc mật khẩu không đúng.',
  );
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly tokenService: TokenService,
    private readonly loginAttempts: LoginAttemptsService,
    private readonly otpService: OtpService,
  ) {}

  /**
   * Đăng ký luôn tạo vai trò CUSTOMER; tài khoản nhân viên do admin cấp.
   * Chưa cấp token: phải xác minh email bằng OTP rồi mới đăng nhập được (ADR-0017).
   */
  async register(dto: RegisterDto): Promise<{ email: string; expiresInSeconds: number }> {
    const passwordHash = await this.passwordHasher.hash(dto.password);
    const { email } = await this.usersRepository.create({
      email: dto.email,
      fullName: dto.fullName,
      passwordHash,
    });
    try {
      const { expiresInSeconds } = await this.otpService.send({
        email,
        purpose: OtpPurpose.VERIFY_EMAIL,
      });
      return { email, expiresInSeconds };
    } catch {
      // Tài khoản đã tạo; OtpService đã log, người dùng bấm gửi lại ở trang xác minh.
      return { email, expiresInSeconds: 0 };
    }
  }

  async verifyEmail({ email, purpose, code }: VerifyOtpDto): Promise<{ verified: true }> {
    await this.otpService.consume(email, purpose, code);
    await this.usersRepository.markEmailVerified(email);
    return { verified: true };
  }

  /** Nhận được mã tức là giữ hộp thư, nên email cũng được coi là đã xác minh. */
  async resetPassword({ email, code, newPassword }: ResetPasswordDto): Promise<void> {
    await this.otpService.consume(email, OtpPurpose.RESET_PASSWORD, code);
    const passwordHash = await this.passwordHasher.hash(newPassword);
    const userId = await this.usersRepository.updatePassword(email, passwordHash);
    if (!userId) throw invalidOtp();
    await this.usersRepository.markEmailVerified(email);
    await this.tokenService.revokeAllForUser(userId);
    await this.loginAttempts.reset(email);
  }

  async login(dto: LoginDto, client: ClientContext): Promise<AuthResult> {
    // Kiểm khoá trước bcrypt: đang khoá thì không cho thử mật khẩu nào, kể cả đúng.
    await this.loginAttempts.assertNotLocked(dto.email);

    const user = await this.usersRepository.findByEmailWithPassword(dto.email);
    // Email không tồn tại cũng đếm và bị khoá y hệt, để không dò được email nào đã đăng ký.
    let valid = false;
    if (user) valid = await this.passwordHasher.compare(dto.password, user.passwordHash);
    else await this.passwordHasher.compareDummy(dto.password);
    if (!user || !valid) {
      await this.loginAttempts.recordFailure(dto.email);
      throw invalidCredentials();
    }

    await this.loginAttempts.reset(dto.email);
    // Kiểm sau mật khẩu: người không biết mật khẩu không biết được trạng thái tài khoản.
    if (!user.emailVerifiedAt) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        'EMAIL_NOT_VERIFIED',
        'Email chưa được xác minh, vui lòng nhập mã OTP để kích hoạt tài khoản.',
      );
    }
    const tokens = await this.tokenService.issueTokens(user, client);
    return { user: toPublicUser(user), ...tokens };
  }

  refresh(refreshToken: string, client: ClientContext): Promise<AuthTokens> {
    return this.tokenService.rotate(refreshToken, client);
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokenService.revoke(refreshToken);
  }

  logoutAll(userId: string): Promise<void> {
    return this.tokenService.revokeAllForUser(userId);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Tài khoản không còn tồn tại, vui lòng đăng nhập lại.',
      );
    }
    return user;
  }
}
