import { Role, User } from '@prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { UsersRepository } from '../users/users.repository';
import { AuthService } from './auth.service';
import type { AuthTokens } from './auth.types';
import { LoginAttemptsService, loginLocked } from './login-attempts.service';
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
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};

describe('AuthService', () => {
  let users: jest.Mocked<Pick<UsersRepository, 'create' | 'findByEmailWithPassword' | 'findById'>>;
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
    );
  });

  describe('register', () => {
    it('băm mật khẩu, tạo user và cấp token', async () => {
      const { passwordHash: _hash, updatedAt: _updated, ...publicUser } = storedUser;
      users.create.mockResolvedValue(publicUser);

      const result = await service.register(
        { email: storedUser.email, password: 'matkhau123', fullName: 'Trần Bình' },
        client,
      );

      expect(hasher.hash).toHaveBeenCalledWith('matkhau123');
      expect(users.create).toHaveBeenCalledWith({
        email: storedUser.email,
        fullName: 'Trần Bình',
        passwordHash: 'hashed',
      });
      expect(tokenService.issueTokens).toHaveBeenCalledWith(publicUser, client);
      expect(result).toEqual({ user: publicUser, ...tokens });
    });

    it('trả lỗi khi email đã tồn tại và không cấp token', async () => {
      users.create.mockRejectedValue(new AppException(409, 'EMAIL_ALREADY_EXISTS', 'trùng'));

      await expect(
        service.register(
          { email: storedUser.email, password: 'matkhau123', fullName: 'Trần Bình' },
          client,
        ),
      ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_EXISTS' });
      expect(tokenService.issueTokens).not.toHaveBeenCalled();
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
      const { passwordHash: _hash, updatedAt: _updated, ...publicUser } = storedUser;
      users.findById.mockResolvedValue(publicUser);

      await expect(service.me(storedUser.id)).resolves.toEqual(publicUser);
    });

    it('user đã bị xoá → UNAUTHENTICATED', async () => {
      users.findById.mockResolvedValue(null);

      await expect(service.me(storedUser.id)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });
  });
});
