import type { DefaultJobOptions } from 'bullmq';

/** Tên queue (F05, ADR-0009). */
export const EMAIL_QUEUE = 'email';
export const INVOICE_QUEUE = 'invoice';
export const INVENTORY_SYNC_QUEUE = 'inventory-sync';
/** Phân loại ticket hỗ trợ bằng LLM (F06, ADR-0011). */
export const TICKET_CLASSIFY_QUEUE = 'ticket-classify';
/** Job hết lượt thử của mọi queue khác; không có worker, chỉ lưu để xem và xử lý tay. */
export const DEAD_LETTER_QUEUE = 'dead-letter';

export const WORKER_QUEUES = [
  EMAIL_QUEUE,
  INVOICE_QUEUE,
  INVENTORY_SYNC_QUEUE,
  TICKET_CLASSIFY_QUEUE,
] as const;
export const ALL_QUEUES = [...WORKER_QUEUES, DEAD_LETTER_QUEUE] as const;
export type WorkerQueue = (typeof WORKER_QUEUES)[number];

/** Tên job trong từng queue; với email, tên job cũng là "loại email" trong bảng email_deliveries. */
export const EmailJob = {
  ORDER_CONFIRMATION: 'order-confirmation',
  PAYMENT_REMINDER: 'payment-reminder',
  DAILY_REVENUE_REPORT: 'daily-revenue-report',
} as const;
export type EmailJobName = (typeof EmailJob)[keyof typeof EmailJob];

export const INVOICE_JOB = 'invoice';
export const InventorySyncJob = {
  RESERVE: 'inventory-reserve',
  RELEASE: 'inventory-release',
} as const;
export type InventorySyncJobName = (typeof InventorySyncJob)[keyof typeof InventorySyncJob];

export const TICKET_CLASSIFY_JOB = 'ticket-classify';

export interface TicketJobData {
  ticketId: string;
  code: string;
}

export const DAILY_REPORT_SCHEDULER_ID = 'daily-revenue-report';
export const DAILY_REPORT_CRON = '0 0 * * *';

/** Payload chỉ mang id: worker đọc dữ liệu mới nhất từ DB khi chạy. */
export interface OrderJobData {
  orderId: string;
  code: string;
}

export interface DailyReportJobData {
  /** Ngày báo cáo "YYYY-MM-DD" theo REPORT_TIMEZONE; bỏ trống = hôm qua tính từ lúc chạy. */
  date?: string;
}

export interface DeadLetterData {
  queue: string;
  jobName: string;
  jobId: string | undefined;
  data: unknown;
  failedReason: string;
  stacktrace: string[];
  attemptsMade: number;
  failedAt: string;
}

/**
 * jobId cố định theo loại job + orderId: đẩy lại cùng job (event phát lại, retry tay) khi job cũ
 * còn lưu trong Redis thì BullMQ bỏ qua. BullMQ cấm ":" trong custom id nên dùng "-".
 */
export const orderJobId = (jobName: string, orderId: string) => `${jobName}-${orderId}`;

/** Cùng quy ước với orderJobId: một job phân loại cho mỗi ticket. */
export const ticketJobId = (jobName: string, ticketId: string) => `${jobName}-${ticketId}`;

const DAY_SECONDS = 24 * 60 * 60;

/** Số lần thử và hệ số backoff (nhân với QUEUE_BACKOFF_BASE_MS) của từng queue. */
const RETRY_POLICY: Record<WorkerQueue, { attempts: number; backoffFactor: number }> = {
  [EMAIL_QUEUE]: { attempts: 5, backoffFactor: 1 },
  [INVOICE_QUEUE]: { attempts: 3, backoffFactor: 2 },
  // Đối tác hay lỗi tạm thời: thử nhiều lần, chờ ngắn hơn.
  [INVENTORY_SYNC_QUEUE]: { attempts: 6, backoffFactor: 0.5 },
  // LLM quá tải/429: thử lại vài lần; lần cuối vẫn lỗi thì service gán KHAC (không kẹt ticket).
  [TICKET_CLASSIFY_QUEUE]: { attempts: 4, backoffFactor: 2 },
};

export function jobOptionsFor(queue: WorkerQueue, backoffBaseMs: number): DefaultJobOptions {
  const { attempts, backoffFactor } = RETRY_POLICY[queue];
  return {
    attempts,
    backoff: { type: 'exponential', delay: Math.max(1, Math.round(backoffBaseMs * backoffFactor)) },
    removeOnComplete: { age: 7 * DAY_SECONDS, count: 1000 },
    removeOnFail: { age: 30 * DAY_SECONDS },
  };
}

export const DEAD_LETTER_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 1,
  removeOnComplete: { age: 30 * DAY_SECONDS },
  removeOnFail: { age: 30 * DAY_SECONDS },
};
