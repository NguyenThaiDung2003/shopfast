import { Injectable } from '@nestjs/common';
import { EmailDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/** Claim SENDING quá lâu chưa xong = worker đã chết giữa chừng, cho phép giành lại. */
export const STALE_CLAIM_MINUTES = 10;

/**
 * Sổ ghi email đã gửi (ADR-0009). Unique (kind, ref) là bảo đảm thật cho "không gửi hai lần":
 * jobId cố định chỉ chống trùng khi job cũ còn trong Redis.
 */
@Injectable()
export class EmailDeliveriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Giành quyền gửi, nguyên tử: chèn dòng SENDING; trùng (kind, ref) thì chỉ giành lại khi dòng
   * cũ vẫn SENDING và đã quá STALE_CLAIM_MINUTES. Trả id dòng nếu giành được, null nếu không.
   */
  async claim(kind: string, ref: string, recipient: string): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: number }>>`
      INSERT INTO email_deliveries (kind, ref, recipient)
      VALUES (${kind}, ${ref}, ${recipient})
      ON CONFLICT (kind, ref) DO UPDATE
        SET claimed_at = now(), recipient = EXCLUDED.recipient
        WHERE email_deliveries.status = 'SENDING'
          AND email_deliveries.claimed_at < now() - ${STALE_CLAIM_MINUTES} * interval '1 minute'
      RETURNING id`;
    return rows[0]?.id ?? null;
  }

  async markSent(id: number): Promise<void> {
    await this.prisma.emailDelivery.update({
      where: { id },
      data: { status: EmailDeliveryStatus.SENT, sentAt: new Date() },
    });
  }

  /** Gửi lỗi: trả claim để lần thử sau (BullMQ retry) giành lại được ngay. */
  async release(id: number): Promise<void> {
    await this.prisma.emailDelivery.deleteMany({
      where: { id, status: EmailDeliveryStatus.SENDING },
    });
  }
}
