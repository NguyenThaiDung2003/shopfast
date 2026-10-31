import { Injectable } from '@nestjs/common';
import { EmailDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/** Claim SENDING quá lâu chưa xong = worker đã chết giữa chừng, cho phép giành lại. */
export const STALE_CLAIM_MINUTES = 10;

export type EmailClaim =
  | { status: 'claimed'; id: number }
  | { status: 'sent' }
  /** Lần chạy khác đang giữ claim; `retryAfterMs` là lúc claim đó hết hạn. */
  | { status: 'busy'; retryAfterMs: number };

/**
 * Sổ ghi email đã gửi (ADR-0009). Unique (kind, ref) là bảo đảm thật cho "không gửi hai lần":
 * jobId cố định chỉ chống trùng khi job cũ còn trong Redis.
 */
@Injectable()
export class EmailDeliveriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Giành quyền gửi, nguyên tử: chèn dòng SENDING; trùng (kind, ref) thì chỉ giành lại khi dòng
   * cũ vẫn SENDING và đã quá STALE_CLAIM_MINUTES. Không giành được thì đọc lại để phân biệt thư đã
   * gửi với claim của lần chạy khác: nhầm hai trường hợp này sẽ làm mất thư khi worker chết.
   */
  async claim(kind: string, ref: string, recipient: string): Promise<EmailClaim> {
    const rows = await this.prisma.$queryRaw<Array<{ id: number }>>`
      INSERT INTO email_deliveries (kind, ref, recipient)
      VALUES (${kind}, ${ref}, ${recipient})
      ON CONFLICT (kind, ref) DO UPDATE
        SET claimed_at = now(), recipient = EXCLUDED.recipient
        WHERE email_deliveries.status = 'SENDING'
          AND email_deliveries.claimed_at < now() - ${STALE_CLAIM_MINUTES} * interval '1 minute'
      RETURNING id`;
    if (rows[0]) return { status: 'claimed', id: rows[0].id };

    const [held] = await this.prisma.$queryRaw<Array<{ status: EmailDeliveryStatus; ms: number }>>`
      SELECT status, GREATEST(0, EXTRACT(EPOCH FROM (
        claimed_at + ${STALE_CLAIM_MINUTES} * interval '1 minute' - now()
      )) * 1000)::float8 AS ms
      FROM email_deliveries WHERE kind = ${kind} AND ref = ${ref}`;
    // Dòng vừa bị `release` giữa hai câu: coi như bận rất ngắn, lần chạy sau giành được ngay.
    if (!held) return { status: 'busy', retryAfterMs: 0 };
    return held.status === EmailDeliveryStatus.SENT
      ? { status: 'sent' }
      : { status: 'busy', retryAfterMs: held.ms };
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
