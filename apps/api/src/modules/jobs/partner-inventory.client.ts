import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';

export const PARTNER_INVENTORY_CLIENT = Symbol('PARTNER_INVENTORY_CLIENT');

export interface PartnerStockChange {
  /** Khoá chống trùng gửi kèm cho đối tác (= jobId): gọi lại cùng khoá không bị tính hai lần. */
  idempotencyKey: string;
  orderCode: string;
  /** reserve: đơn mới giữ hàng; release: đơn huỷ trả hàng. */
  action: 'reserve' | 'release';
  items: Array<{ sku: string; quantity: number }>;
}

/** API đồng bộ tồn kho của đối tác bán hàng. */
export interface PartnerInventoryClient {
  pushStockChange(change: PartnerStockChange): Promise<void>;
}

export class PartnerUnavailableError extends Error {
  constructor(message = 'Partner inventory API returned 503') {
    super(message);
    this.name = 'PartnerUnavailableError';
  }
}

/**
 * Đối tác giả lập: có độ trễ và lỗi ngẫu nhiên theo PARTNER_FAILURE_RATE để demo retry/backoff
 * và dead-letter. Ghi nhớ khoá đã nhận, như một API đối tác có hỗ trợ idempotency.
 */
@Injectable()
export class FakePartnerInventoryClient implements PartnerInventoryClient {
  private readonly logger = new Logger(FakePartnerInventoryClient.name);
  private readonly failureRate: number;
  private readonly latencyMs: number;
  private readonly accepted = new Set<string>();

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.failureRate = config.get('PARTNER_FAILURE_RATE', { infer: true });
    this.latencyMs = config.get('PARTNER_LATENCY_MS', { infer: true });
  }

  async pushStockChange(change: PartnerStockChange): Promise<void> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    if (this.random() < this.failureRate) throw new PartnerUnavailableError();
    if (this.accepted.has(change.idempotencyKey)) return;
    this.accepted.add(change.idempotencyKey);
    this.logger.log(
      `[GIẢ LẬP] Đối tác nhận ${change.action} cho đơn ${change.orderCode}: ` +
        change.items.map((i) => `${i.sku}×${i.quantity}`).join(', '),
    );
  }

  /** Tách riêng để unit test cố định kết quả. */
  protected random(): number {
    return Math.random();
  }
}
