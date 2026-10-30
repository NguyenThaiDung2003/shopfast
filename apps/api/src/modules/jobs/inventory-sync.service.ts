import { Inject, Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { JobsRepository } from './jobs.repository';
import { PARTNER_INVENTORY_CLIENT, PartnerInventoryClient } from './partner-inventory.client';
import { InventorySyncJob, InventorySyncJobName } from './queues';

/** Đẩy thay đổi tồn kho của đơn sang đối tác (F05). Lỗi đối tác → ném để BullMQ thử lại. */
@Injectable()
export class InventorySyncService {
  constructor(
    private readonly jobsRepository: JobsRepository,
    @Inject(PARTNER_INVENTORY_CLIENT) private readonly partner: PartnerInventoryClient,
  ) {}

  async sync(
    jobName: InventorySyncJobName,
    orderId: string,
    idempotencyKey: string,
  ): Promise<{ status: 'synced'; items: number }> {
    const order = await this.jobsRepository.findOrder(orderId);
    if (!order) throw new UnrecoverableError(`Order ${orderId} not found`);

    await this.partner.pushStockChange({
      idempotencyKey,
      orderCode: order.code,
      action: jobName === InventorySyncJob.RESERVE ? 'reserve' : 'release',
      items: order.items.map((i) => ({ sku: i.product.sku, quantity: i.quantity })),
    });
    return { status: 'synced', items: order.items.length };
  }
}
