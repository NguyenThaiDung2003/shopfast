import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@prisma/client';
import { UnrecoverableError } from 'bullmq';
import type { EnvironmentVariables } from '../../config/env.validation';
import { renderInvoicePdf } from './invoice-pdf';
import { JobsRepository } from './jobs.repository';

/** Trạng thái đã qua bước thanh toán (ADR-0006). */
const PAID_OR_LATER: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPING,
  OrderStatus.DELIVERED,
];

export type InvoiceJobResult =
  { status: 'generated'; file: string; bytes: number } | { status: 'skipped'; reason: string };

/** Xuất hoá đơn PDF khi đơn đã thanh toán (F05). */
@Injectable()
export class InvoiceService {
  private readonly storageDir: string;

  constructor(
    private readonly jobsRepository: JobsRepository,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.storageDir = resolve(config.get('INVOICE_STORAGE_DIR', { infer: true }));
  }

  filePath(code: string): string {
    return join(this.storageDir, `${code}.pdf`);
  }

  /**
   * Ghi `<code>.pdf` qua file tạm rồi rename (nguyên tử): không bao giờ có file dở dang, chạy lại
   * chỉ ghi đè đúng file đó – không sinh hoá đơn thứ hai.
   */
  async generate(orderId: string): Promise<InvoiceJobResult> {
    const order = await this.jobsRepository.findOrder(orderId);
    if (!order) throw new UnrecoverableError(`Order ${orderId} not found`);
    if (!PAID_OR_LATER.includes(order.status)) {
      return { status: 'skipped', reason: `status_${order.status}` };
    }

    const pdf = await renderInvoicePdf(order);
    await mkdir(this.storageDir, { recursive: true });
    const target = this.filePath(order.code);
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, pdf);
    await rename(temp, target);
    return { status: 'generated', file: target, bytes: pdf.length };
  }
}
