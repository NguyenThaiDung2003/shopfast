// Import ĐẦU TIÊN trong jobs.e2e-spec.ts (ConfigModule đọc env ngay khi AppModule được import).
// setup-env.ts tắt worker cho các suite khác; suite này bật và dùng prefix riêng để worker của
// nó không nhận job do suite khác đẩy (và ngược lại).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const INVOICE_DIR = mkdtempSync(join(tmpdir(), 'shopfast-e2e-invoices-'));
export const QUEUE_PREFIX = `jobs-e2e-${process.pid}`;

process.env.QUEUE_WORKERS_ENABLED = 'true';
process.env.QUEUE_PREFIX = QUEUE_PREFIX;
// Backoff exponential 10ms → 6 lần thử inventory-sync xong trong ~0,2s.
process.env.QUEUE_BACKOFF_BASE_MS = '10';
// Đủ dài để test chủ động promote job nhắc thanh toán thay vì chờ.
process.env.PAYMENT_REMINDER_DELAY_MS = '600000';
process.env.INVOICE_STORAGE_DIR = INVOICE_DIR;
process.env.PARTNER_LATENCY_MS = '0';
