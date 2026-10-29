import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { PublicUser, toPublicUser, UsersRepository } from '../users/users.repository';
import type { AuthResult, AuthTokens, ClientContext } from './auth.types';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { LoginAttemptsService } from './login-attempts.service';
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
  ) {}

  /** Đăng ký luôn tạo vai trò CUSTOMER; tài khoản nhân viên do admin cấp. */
  async register(dto: RegisterDto, client: ClientContext): Promise<AuthResult> {
    const passwordHash = await this.passwordHasher.hash(dto.password);
    const user = await this.usersRepository.create({
      email: dto.email,
      fullName: dto.fullName,
      passwordHash,
    });
    const tokens = await this.tokenService.issueTokens(user, client);
    return { user, ...tokens };
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
