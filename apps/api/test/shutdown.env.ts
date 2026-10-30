// Import ĐẦU TIÊN trong shutdown.e2e-spec.ts (ConfigModule đọc env ngay khi AppModule được import).
// Bật worker với prefix riêng (như jobs.env.ts) và drain đủ dài để quan sát /health lúc đang tắt.
export const QUEUE_PREFIX = `shutdown-e2e-${process.pid}`;

process.env.QUEUE_WORKERS_ENABLED = 'true';
process.env.QUEUE_PREFIX = QUEUE_PREFIX;
process.env.QUEUE_BACKOFF_BASE_MS = '10';
process.env.PAYMENT_REMINDER_DELAY_MS = '600000';
process.env.PARTNER_LATENCY_MS = '0';
process.env.PARTNER_FAILURE_RATE = '0';
export const DRAIN_MS = 600;
process.env.SHUTDOWN_DRAIN_MS = String(DRAIN_MS);
process.env.SHUTDOWN_TIMEOUT_MS = '15000';
