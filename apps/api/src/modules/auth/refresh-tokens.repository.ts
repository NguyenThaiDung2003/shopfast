import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface NewRefreshToken {
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string;
  ip?: string;
}

const refreshTokenSelect = {
  id: true,
  userId: true,
  familyId: true,
  expiresAt: true,
  revokedAt: true,
  user: { select: { role: true } },
} satisfies Prisma.RefreshTokenSelect;

export type StoredRefreshToken = Prisma.RefreshTokenGetPayload<{
  select: typeof refreshTokenSelect;
}>;

@Injectable()
export class RefreshTokensRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(token: NewRefreshToken): Promise<void> {
    await this.prisma.refreshToken.create({ data: token });
  }

  findByHash(tokenHash: string): Promise<StoredRefreshToken | null> {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: refreshTokenSelect,
    });
  }

  /**
   * Thu hồi token cũ và lưu token mới trong một transaction.
   * Trả false nếu token cũ đã bị thu hồi trước đó (request refresh song song hoặc bị dùng lại).
   */
  rotate(oldTokenId: string, next: NewRefreshToken): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.refreshToken.updateMany({
        where: { id: oldTokenId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count !== 1) return false;
      await tx.refreshToken.create({ data: next });
      return true;
    });
  }

  async revokeFamily(familyId: string): Promise<number> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }
}
