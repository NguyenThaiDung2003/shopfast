import { Role, User } from '@prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { UsersRepository } from '../users/users.repository';
import { AuthService } from './auth.service';
import type { AuthTokens } from './auth.types';
import { OtpPurpose } from './dto/send-otp.dto';
import { LoginAttemptsService, loginLocked } from './login-attempts.service';
import { OtpService } from './otp.service';
import { PasswordHasher } from './password-hasher';
import { TokenService } from './token.service';

const client = { userAgent: 'jest', ip: '127.0.0.1' };
const tokens: AuthTokens = {
  accessToken: 'access',
  refreshToken: 'refresh',
  tokenType: 'Bearer',
  expiresIn: 900,
};
const storedUser: User = {
  id: 'b3c1c2f0-0000-4000-8000-000000000001',
  email: 'customer01@shopfast.local',
  passwordHash: '$2a$04$hash',
  fullName: 'Trần Bình',
  role: Role.CUSTOMER,
  emailVerifiedAt: new Date('2026-10-01T00:00:00Z'),
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};
const {
  passwordHash: _hash,
  updatedAt: _updated,
  emailVerifiedAt: _at,
  ...publicUser
} = storedUser;
const registerDto = { email: storedUser.email, password: 'matkhau123', fullName: 'Trần Bình' };

describe('AuthService', () => {
  let users: jest.Mocked<
    Pick<
      UsersRepository,
      'create' | 'findByEmailWithPassword' | 'findById' | 'markEmailVerified' | 'updatePassword'
    >
  >;
  let otp: jest.Mocked<Pick<OtpService, 'send' | 'consume'>>;
  let hasher: jest.Mocked<Pick<PasswordHasher, 'hash' | 'compare' | 'compareDummy'>>;
  let tokenService: jest.Mocked<
    Pick<TokenService, 'issueTokens' | 'rotate' | 'revoke' | 'revokeAllForUser'>
  >;
  let loginAttempts: jest.Mocked<
    Pick<LoginAttemptsService, 'assertNotLocked' | 'recordFailure' | 'reset'>
  >;
  let service: AuthService;

  beforeEach(() => {
    users = {
      create: jest.fn(),
      findByEmailWithPassword: jest.fn(),
      findById: jest.fn(),
      markEmailVerified: jest.fn().mockResolvedValue(undefined),
      updatePassword: jest.fn().mockResolvedValue(storedUser.id),
    };
    otp = {
      send: jest.fn().mockResolvedValue({ expiresInSeconds: 300 }),
      consume: jest.fn().mockResolvedValue(undefined),
    };
    hasher = {
      hash: jest.fn().mockResolvedValue('hashed'),
      compare: jest.fn(),
      compareDummy: jest.fn().mockResolvedValue(undefined),
    };
    tokenService = {
      issueTokens: jest.fn().mockResolvedValue(tokens),
      rotate: jest.fn().mockResolvedValue(tokens),
      revoke: jest.fn().mockResolvedValue(undefined),
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
    };
    loginAttempts = {
      assertNotLocked: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
      reset: jest.fn().mockResolvedValue(undefined),
    };
    service = new AuthService(
      users as unknown as UsersRepository,
      hasher as unknown as PasswordHasher,
      tokenService as unknown as TokenService,
      loginAttempts as unknown as LoginAttemptsService,
      otp as unknown as OtpService,
    );
  });

  describe('register', () => {
    it('băm mật khẩu, tạo user, gửi OTP và không cấp token', async () => {
      users.create.mockResolvedValue(publicUser);

      const result = await service.register(registerDto);

      expect(hasher.hash).toHaveBeenCalledWith('matkhau123');
      expect(users.create).toHaveBeenCalledWith({
        email: storedUser.email,
        fullName: 'Trần Bình',
        passwordHash: 'hashed',
      });
      expect(otp.send).toHaveBeenCalledWith({
        email: storedUser.email,
        purpose: OtpPurpose.VERIFY_EMAIL,
      });
      expect(tokenService.issueTokens).not.toHaveBeenCalled();
      expect(result).toEqual({ email: storedUser.email, expiresInSeconds: 300 });
    });

    it('trả lỗi khi email đã tồn tại và không gửi OTP', async () => {
      users.create.mockRejectedValue(new AppException(409, 'EMAIL_ALREADY_EXISTS', 'trùng'));

      await expect(service.register(registerDto)).rejects.toMatchObject({
        code: 'EMAIL_ALREADY_EXISTS',
      });
      expect(otp.send).not.toHaveBeenCalled();
    });

    it('gửi OTP lỗi → tài khoản vẫn tạo, trả hạn mã 0 để web mời gửi lại', async () => {
      users.create.mockResolvedValue(publicUser);
      otp.send.mockRejectedValue(new AppException(503, 'SERVICE_UNAVAILABLE', 'lỗi'));

      await expect(service.register(registerDto)).resolves.toEqual({
        email: storedUser.email,
        expiresInSeconds: 0,
      });
    });
  });

  describe('verifyEmail', () => {
    it('đúng mã → đánh dấu đã xác minh', async () => {
      const dto = { email: storedUser.email, purpose: OtpPurpose.VERIFY_EMAIL, code: '123456' };

      await expect(service.verifyEmail(dto)).resolves.toEqual({ verified: true });
      expect(otp.consume).toHaveBeenCalledWith(storedUser.email, dto.purpose, '123456');
      expect(users.markEmailVerified).toHaveBeenCalledWith(storedUser.email);
    });

    it('sai mã → không đánh dấu', async () => {
      otp.consume.mockRejectedValue(new AppException(400, 'OTP_INVALID', 'sai'));

      await expect(
        service.verifyEmail({
          email: storedUser.email,
          purpose: OtpPurpose.VERIFY_EMAIL,
          code: '000000',
        }),
      ).rejects.toMatchObject({ code: 'OTP_INVALID' });
      expect(users.markEmailVerified).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    const dto = { email: storedUser.email, code: '123456', newPassword: 'matkhaumoi1' };

    it('đổi mật khẩu, xác minh email, thu hồi mọi phiên, xoá khoá đăng nhập', async () => {
      await service.resetPassword(dto);

      expect(otp.consume).toHaveBeenCalledWith(
        storedUser.email,
        OtpPurpose.RESET_PASSWORD,
        '123456',
      );
      expect(users.updatePassword).toHaveBeenCalledWith(storedUser.email, 'hashed');
      expect(users.markEmailVerified).toHaveBeenCalledWith(storedUser.email);
      expect(tokenService.revokeAllForUser).toHaveBeenCalledWith(storedUser.id);
      expect(loginAttempts.reset).toHaveBeenCalledWith(storedUser.email);
    });

    it('sai mã → không đổi mật khẩu', async () => {
      otp.consume.mockRejectedValue(new AppException(400, 'OTP_INVALID', 'sai'));

      await expect(service.resetPassword(dto)).rejects.toMatchObject({ code: 'OTP_INVALID' });
      expect(users.updatePassword).not.toHaveBeenCalled();
    });

    it('email không có tài khoản → OTP_INVALID', async () => {
      users.updatePassword.mockResolvedValue(null);

      await expect(service.resetPassword(dto)).rejects.toMatchObject({ code: 'OTP_INVALID' });
      expect(tokenService.revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('cấp token khi đúng mật khẩu và không trả passwordHash', async () => {
      users.findByEmailWithPassword.mockResolvedValue(storedUser);
      hasher.compare.mockResolvedValue(true);

      const result = await service.login(
        { email: storedUser.email, password: 'dung-mat-khau1' },
        client,
      );

      expect(result.accessToken).toBe('access');
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user.role).toBe(Role.CUSTOMER);
      expect(loginAttempts.reset).toHaveBeenCalledWith(storedUser.email);
      expect(loginAttempts.recordFailure).not.toHaveBeenCalled();
    });

    it('đúng mật khẩu nhưng chưa xác minh email → 403, không cấp token', async () => {
      users.findByEmailWithPassword.mockResolvedValue({ ...storedUser, emailVerifiedAt: null });
      hasher.compare.mockResolvedValue(true);

      await expect(
        service.login({ email: storedUser.email, password: 'dung-mat-khau1' }, client),
      ).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
      expect(tokenService.issueTokens).not.toHaveBeenCalled();
    });

    it('chưa xác minh nhưng sai mật khẩu → không lộ trạng thái', async () => {
      users.findByEmailWithPassword.mockResolvedValue({ ...storedUser, emailVerifiedAt: null });
      hasher.compare.mockResolvedValue(false);

      await expect(
        service.login({ email: storedUser.email, password: 'sai' }, client),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('sai mật khẩu → INVALID_CREDENTIALS', async () => {
      users.findByEmailWithPassword.mockResolvedValue(storedUser);
      hasher.compare.mockResolvedValue(false);

      const promise = service.login({ email: storedUser.email, password: 'sai' }, client);

      await expect(promise).rejects.toBeInstanceOf(AppException);
      await expect(promise).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
        userMessage: 'Email hoặc mật khẩu không đúng.',
      });
      expect(tokenService.issueTokens).not.toHaveBeenCalled();
      expect(loginAttempts.recordFailure).toHaveBeenCalledWith(storedUser.email);
      expect(loginAttempts.reset).not.toHaveBeenCalled();
    });

    it('email không tồn tại → cùng lỗi, vẫn tốn thời gian so mật khẩu giả và vẫn bị đếm', async () => {
      users.findByEmailWithPassword.mockResolvedValue(null);

      await expect(
        service.login({ email: 'khongco@shopfast.local', password: 'bat-ky1' }, client),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect(hasher.compareDummy).toHaveBeenCalledWith('bat-ky1');
      expect(hasher.compare).not.toHaveBeenCalled();
      expect(loginAttempts.recordFailure).toHaveBeenCalledWith('khongco@shopfast.local');
    });

    it('đang khoá → LOGIN_LOCKED trước khi đọc DB hay chạy bcrypt, kể cả mật khẩu đúng', async () => {
      loginAttempts.assertNotLocked.mockRejectedValue(loginLocked(300_000));
      users.findByEmailWithPassword.mockResolvedValue(storedUser);
      hasher.compare.mockResolvedValue(true);

      await expect(
        service.login({ email: storedUser.email, password: 'dung-mat-khau1' }, client),
      ).rejects.toMatchObject({ code: 'LOGIN_LOCKED', details: { retryAfterSeconds: 300 } });
      expect(users.findByEmailWithPassword).not.toHaveBeenCalled();
      expect(hasher.compare).not.toHaveBeenCalled();
      expect(tokenService.issueTokens).not.toHaveBeenCalled();
    });

    it('lần sai làm khoá → trả LOGIN_LOCKED thay cho INVALID_CREDENTIALS', async () => {
      users.findByEmailWithPassword.mockResolvedValue(storedUser);
      hasher.compare.mockResolvedValue(false);
      loginAttempts.recordFailure.mockRejectedValue(loginLocked(60_000));

      await expect(
        service.login({ email: storedUser.email, password: 'sai' }, client),
      ).rejects.toMatchObject({ code: 'LOGIN_LOCKED', details: { retryAfterSeconds: 60 } });
    });
  });

  it('refresh/logout/logoutAll chuyển cho TokenService', async () => {
    await service.refresh('r1', client);
    await service.logout('r2');
    await service.logoutAll(storedUser.id);

    expect(tokenService.rotate).toHaveBeenCalledWith('r1', client);
    expect(tokenService.revoke).toHaveBeenCalledWith('r2');
    expect(tokenService.revokeAllForUser).toHaveBeenCalledWith(storedUser.id);
  });

  describe('me', () => {
    it('trả thông tin user', async () => {
      users.findById.mockResolvedValue(publicUser);

      await expect(service.me(storedUser.id)).resolves.toEqual(publicUser);
    });

    it('user đã bị xoá → UNAUTHENTICATED', async () => {
      users.findById.mockResolvedValue(null);

      await expect(service.me(storedUser.id)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });
  });
});
