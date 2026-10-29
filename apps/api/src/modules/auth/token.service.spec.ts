import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { RefreshTokensRepository, StoredRefreshToken } from './refresh-tokens.repository';
import { durationToSeconds, hashRefreshToken, TokenService } from './token.service';

const SECRET = 'unit-test-secret-unit-test-secret-1234';
const user = { id: 'b3c1c2f0-0000-4000-8000-000000000001', role: Role.CUSTOMER };
const client = { userAgent: 'jest', ip: '127.0.0.1' };

function storedToken(overrides: Partial<StoredRefreshToken> = {}): StoredRefreshToken {
  return {
    id: 'token-1',
    userId: user.id,
    familyId: 'family-1',
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    user: { role: Role.WAREHOUSE },
    ...overrides,
  };
}

describe('TokenService', () => {
  let repository: jest.Mocked<
    Pick<
      RefreshTokensRepository,
      'create' | 'findByHash' | 'rotate' | 'revokeFamily' | 'revokeAllForUser'
    >
  >;
  let jwt: JwtService;
  let service: TokenService;

  beforeEach(() => {
    repository = {
      create: jest.fn().mockResolvedValue(undefined),
      findByHash: jest.fn(),
      rotate: jest.fn().mockResolvedValue(true),
      revokeFamily: jest.fn().mockResolvedValue(2),
      revokeAllForUser: jest.fn().mockResolvedValue(3),
    };
    jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: '15m' } });
    const config = {
      get: (key: string) => ({ JWT_ACCESS_TTL: '15m', REFRESH_TOKEN_TTL_DAYS: 7 })[key],
    } as unknown as ConfigService<EnvironmentVariables, true>;
    service = new TokenService(jwt, repository as unknown as RefreshTokensRepository, config);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  });

  it('durationToSeconds đổi đúng đơn vị', () => {
    expect(durationToSeconds('45s')).toBe(45);
    expect(durationToSeconds('15m')).toBe(900);
    expect(durationToSeconds('2h')).toBe(7200);
    expect(durationToSeconds('1d')).toBe(86400);
  });

  describe('issueTokens', () => {
    it('cấp access JWT và lưu hash (không lưu token gốc) của refresh token', async () => {
      const tokens = await service.issueTokens(user, client);

      expect(tokens.tokenType).toBe('Bearer');
      expect(tokens.expiresIn).toBe(900);
      const saved = repository.create.mock.calls[0]![0];
      expect(saved.tokenHash).toBe(hashRefreshToken(tokens.refreshToken));
      expect(saved.tokenHash).not.toBe(tokens.refreshToken);
      expect(saved.userId).toBe(user.id);
      expect(saved.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
      await expect(service.verifyAccessToken(tokens.accessToken)).resolves.toEqual(user);
    });

    it('mỗi lần đăng nhập là một family mới', async () => {
      await service.issueTokens(user, client);
      await service.issueTokens(user, client);

      const [first, second] = repository.create.mock.calls.map(([t]) => t.familyId);
      expect(first).not.toBe(second);
    });
  });

  describe('rotate', () => {
    it('cấp token mới cùng family, vai trò lấy từ DB', async () => {
      repository.findByHash.mockResolvedValue(storedToken());

      const tokens = await service.rotate('old-token', client);

      expect(repository.findByHash).toHaveBeenCalledWith(hashRefreshToken('old-token'));
      const [oldId, next] = repository.rotate.mock.calls[0]!;
      expect(oldId).toBe('token-1');
      expect(next.familyId).toBe('family-1');
      expect(next.tokenHash).toBe(hashRefreshToken(tokens.refreshToken));
      await expect(service.verifyAccessToken(tokens.accessToken)).resolves.toEqual({
        id: user.id,
        role: Role.WAREHOUSE,
      });
    });

    it('token không tồn tại → INVALID_REFRESH_TOKEN', async () => {
      repository.findByHash.mockResolvedValue(null);

      await expect(service.rotate('la', client)).rejects.toMatchObject({
        code: 'INVALID_REFRESH_TOKEN',
      });
    });

    it('token hết hạn → INVALID_REFRESH_TOKEN, không xoay vòng', async () => {
      repository.findByHash.mockResolvedValue(storedToken({ expiresAt: new Date(Date.now() - 1) }));

      await expect(service.rotate('het-han', client)).rejects.toMatchObject({
        code: 'INVALID_REFRESH_TOKEN',
      });
      expect(repository.rotate).not.toHaveBeenCalled();
    });

    it('dùng lại token đã thu hồi → thu hồi cả family', async () => {
      repository.findByHash.mockResolvedValue(storedToken({ revokedAt: new Date() }));

      await expect(service.rotate('da-dung', client)).rejects.toMatchObject({
        code: 'REFRESH_TOKEN_REUSED',
      });
      expect(repository.revokeFamily).toHaveBeenCalledWith('family-1');
      expect(repository.rotate).not.toHaveBeenCalled();
    });

    it('hai request refresh song song: request thua cũng làm thu hồi family', async () => {
      repository.findByHash.mockResolvedValue(storedToken());
      repository.rotate.mockResolvedValue(false);

      await expect(service.rotate('song-song', client)).rejects.toMatchObject({
        code: 'REFRESH_TOKEN_REUSED',
      });
      expect(repository.revokeFamily).toHaveBeenCalledWith('family-1');
    });
  });

  describe('revoke', () => {
    it('thu hồi family của token', async () => {
      repository.findByHash.mockResolvedValue(storedToken());

      await service.revoke('token');

      expect(repository.revokeFamily).toHaveBeenCalledWith('family-1');
    });

    it('token lạ → bỏ qua (idempotent)', async () => {
      repository.findByHash.mockResolvedValue(null);

      await expect(service.revoke('la')).resolves.toBeUndefined();
      expect(repository.revokeFamily).not.toHaveBeenCalled();
    });

    it('revokeAllForUser thu hồi mọi phiên', async () => {
      await service.revokeAllForUser(user.id);

      expect(repository.revokeAllForUser).toHaveBeenCalledWith(user.id);
    });
  });

  describe('verifyAccessToken', () => {
    it('token hết hạn → TOKEN_EXPIRED', async () => {
      const expired = await jwt.signAsync({ sub: user.id, role: user.role }, { expiresIn: -10 });

      await expect(service.verifyAccessToken(expired)).rejects.toMatchObject({
        code: 'TOKEN_EXPIRED',
      });
    });

    it('chữ ký sai → UNAUTHENTICATED', async () => {
      const forged = await new JwtService({
        secret: 'secret-khac-secret-khac-secret-khac',
      }).signAsync({ sub: user.id, role: Role.ADMIN });

      await expect(service.verifyAccessToken(forged)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });
  });
});
