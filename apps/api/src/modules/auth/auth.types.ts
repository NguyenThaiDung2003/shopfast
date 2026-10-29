import { Role } from '@prisma/client';
import { PublicUser } from '../users/users.repository';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
}

/** User đã xác thực, gắn vào request bởi JwtAuthGuard. */
export interface AuthUser {
  id: string;
  role: Role;
}

export interface ClientContext {
  userAgent?: string;
  ip?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  /** Số giây access token còn hiệu lực. */
  expiresIn: number;
}

export interface AuthResult extends AuthTokens {
  user: PublicUser;
}
