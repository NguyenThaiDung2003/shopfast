import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { AppException } from '../../common/exceptions/app.exception';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { AccessTokenPayload, AuthTokens, AuthUser, ClientContext } from './auth.types';
import { NewRefreshToken, RefreshTokensRepository } from './refresh-tokens.repository';

const DURATION_UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
const DAY_MS = 86_400_000;

/** "15m" → 900. Định dạng đã được Joi validate (^\d+[smhd]$). */
export function durationToSeconds(duration: string): number {
  const unit = duration.slice(-1);
  return Number(duration.slice(0, -1)) * (DURATION_UNIT_SECONDS[unit] ?? 1);
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function invalidRefreshToken(): AppException {
  return new AppException(
    HttpStatus.UNAUTHORIZED,
    'INVALID_REFRESH_TOKEN',
    'Phiên đăng nhập không hợp lệ hoặc đã hết hạn, vui lòng đăng nhập lại.',
  );
}

/**
 * Cấp và kiểm tra token. Cơ chế refresh token (rotation, reuse detection): ADR-0003.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlMs: number;

  constructor(
    private readonly jwtService: JwtService,
    private readonly refreshTokensRepository: RefreshTokensRepository,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.accessTtlSeconds = durationToSeconds(config.get('JWT_ACCESS_TTL', { infer: true }));
    this.refreshTtlMs = config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * DAY_MS;
  }

  /** Cấp cặp token cho một lần đăng nhập mới (family mới). */
  async issueTokens(user: AuthUser, client: ClientContext): Promise<AuthTokens> {
    const refreshToken = this.generateRefreshToken();
    await this.refreshTokensRepository.create(
      this.buildRecord(user.id, randomUUID(), refreshToken, client),
    );
    return this.buildTokens(user, refreshToken);
  }

  async rotate(refreshToken: string, client: ClientContext): Promise<AuthTokens> {
    const stored = await this.refreshTokensRepository.findByHash(hashRefreshToken(refreshToken));
    if (!stored) throw invalidRefreshToken();

    if (stored.revokedAt) {
      return this.handleReuse(stored.familyId, stored.userId);
    }
    if (stored.expiresAt.getTime() <= Date.now()) throw invalidRefreshToken();

    const nextToken = this.generateRefreshToken();
    const rotated = await this.refreshTokensRepository.rotate(
      stored.id,
      this.buildRecord(stored.userId, stored.familyId, nextToken, client),
    );
    // Token vừa bị một request khác thu hồi trước → cũng coi là bị dùng lại.
    if (!rotated) return this.handleReuse(stored.familyId, stored.userId);

    // Vai trò lấy từ DB tại thời điểm refresh: đổi quyền có hiệu lực ở lần refresh kế tiếp.
    return this.buildTokens({ id: stored.userId, role: stored.user.role }, nextToken);
  }

  /** Thu hồi cả family của refresh token. Idempotent: token lạ hoặc đã thu hồi thì bỏ qua. */
  async revoke(refreshToken: string): Promise<void> {
    const stored = await this.refreshTokensRepository.findByHash(hashRefreshToken(refreshToken));
    if (stored) await this.refreshTokensRepository.revokeFamily(stored.familyId);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokensRepository.revokeAllForUser(userId);
  }

  async verifyAccessToken(token: string): Promise<AuthUser> {
    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
      return { id: payload.sub, role: payload.role };
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw new AppException(
          HttpStatus.UNAUTHORIZED,
          'TOKEN_EXPIRED',
          'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.',
        );
      }
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Bạn cần đăng nhập để tiếp tục.',
      );
    }
  }

  private async handleReuse(familyId: string, userId: string): Promise<never> {
    const revoked = await this.refreshTokensRepository.revokeFamily(familyId);
    this.logger.warn(
      `Refresh token reuse detected: user=${userId} family=${familyId} revoked=${revoked}`,
    );
    throw new AppException(
      HttpStatus.UNAUTHORIZED,
      'REFRESH_TOKEN_REUSED',
      'Phiên đăng nhập không còn hợp lệ, vui lòng đăng nhập lại.',
    );
  }

  private async buildTokens(user: AuthUser, refreshToken: string): Promise<AuthTokens> {
    const payload: AccessTokenPayload = { sub: user.id, role: user.role };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTtlSeconds,
    };
  }

  private buildRecord(
    userId: string,
    familyId: string,
    refreshToken: string,
    client: ClientContext,
  ): NewRefreshToken {
    return {
      userId,
      familyId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + this.refreshTtlMs),
      userAgent: client.userAgent,
      ip: client.ip,
    };
  }

  private generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }
}
