import * as Joi from 'joi';

export interface EnvironmentVariables {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_SECRET: string;
  /** Thời hạn access token, cú pháp của jsonwebtoken (ví dụ "15m"). */
  JWT_ACCESS_TTL: string;
  REFRESH_TOKEN_TTL_DAYS: number;
  BCRYPT_ROUNDS: number;
  OTP_TTL_SECONDS: number;
  OTP_MAX_ATTEMPTS: number;
  /** Bật tài liệu API tại /docs (F07: truy cập được trên môi trường thử nghiệm). */
  SWAGGER_ENABLED: boolean;
  /** Timeout mỗi lệnh Redis (ms); quá hạn → lỗi ngay, nơi gọi tự suy giảm. */
  REDIS_COMMAND_TIMEOUT_MS: number;
  /** Bật cache catalog (F04, ADR-0007). */
  CACHE_ENABLED: boolean;
  CACHE_PRODUCT_TTL_SECONDS: number;
  CACHE_LIST_TTL_SECONDS: number;
  /** TTL cho kết quả "không tồn tại" (chống dò id). */
  CACHE_NEGATIVE_TTL_SECONDS: number;
  /** Giá trị `trust proxy` của Express: số proxy (Nginx) đứng trước API (F03, ADR-0008). */
  TRUST_PROXY: string;
  RATE_LIMIT_ENABLED: boolean;
  /** Hạn mức dạng "<số request>/<giây>". */
  RATE_LIMIT_GLOBAL: string;
  RATE_LIMIT_LOGIN: string;
  RATE_LIMIT_OTP_SEND: string;
  RATE_LIMIT_PROMO_ORDER: string;
  /** Số lần đăng nhập sai liên tiếp (theo email) trước khi khoá. */
  LOGIN_MAX_FAILED_ATTEMPTS: number;
  LOGIN_FAILURE_WINDOW_SECONDS: number;
  /** Thời gian khoá tăng dần, phân tách bằng dấu phẩy (giây). */
  LOGIN_LOCKOUT_STEPS_SECONDS: string;
  /** Chạy worker BullMQ trong process này (F05, ADR-0009); tắt để instance chỉ phục vụ API. */
  QUEUE_WORKERS_ENABLED: boolean;
  /** Tiền tố key Redis của BullMQ. */
  QUEUE_PREFIX: string;
  /** Nền của backoff exponential (ms); lần thử thứ n chờ khoảng nền × hệ số queue × 2^(n-1). */
  QUEUE_BACKOFF_BASE_MS: number;
  PAYMENT_REMINDER_DELAY_MS: number;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_SECURE: boolean;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  MAIL_FROM: string;
  INVOICE_STORAGE_DIR: string;
  /** Tỉ lệ lỗi ngẫu nhiên của API đối tác giả lập (0–1), để demo retry. */
  PARTNER_FAILURE_RATE: number;
  PARTNER_LATENCY_MS: number;
  /** Múi giờ cho lịch báo cáo 0h và cách tính "hôm qua". */
  REPORT_TIMEZONE: string;
}

const RATE_LIMIT_PATTERN = /^[1-9]\d*\/[1-9]\d*$/;

// Ứng dụng dừng ngay khi khởi động nếu thiếu hoặc sai biến môi trường (fail-fast).
export const envValidationSchema = Joi.object<EnvironmentVariables>({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.string()
    .pattern(/^\d+[smhd]$/)
    .default('15m'),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().min(1).max(90).default(7),
  BCRYPT_ROUNDS: Joi.number().integer().min(4).max(15).default(12),
  OTP_TTL_SECONDS: Joi.number().integer().min(30).max(3600).default(300),
  OTP_MAX_ATTEMPTS: Joi.number().integer().min(1).max(10).default(5),
  SWAGGER_ENABLED: Joi.boolean().default(true),
  REDIS_COMMAND_TIMEOUT_MS: Joi.number().integer().min(10).max(10_000).default(100),
  CACHE_ENABLED: Joi.boolean().default(true),
  CACHE_PRODUCT_TTL_SECONDS: Joi.number().integer().min(1).max(86_400).default(300),
  CACHE_LIST_TTL_SECONDS: Joi.number().integer().min(1).max(86_400).default(60),
  CACHE_NEGATIVE_TTL_SECONDS: Joi.number().integer().min(1).max(3600).default(30),
  // true | false | số hop | danh sách IP/CIDR (cú pháp của Express).
  TRUST_PROXY: Joi.string()
    .pattern(
      /^(true|false|\d+|[0-9a-fA-F.:/]+(\s*,\s*[0-9a-fA-F.:/]+)*|loopback|linklocal|uniquelocal)$/,
    )
    .default('false'),
  RATE_LIMIT_ENABLED: Joi.boolean().default(true),
  RATE_LIMIT_GLOBAL: Joi.string().pattern(RATE_LIMIT_PATTERN).default('300/60'),
  RATE_LIMIT_LOGIN: Joi.string().pattern(RATE_LIMIT_PATTERN).default('10/60'),
  RATE_LIMIT_OTP_SEND: Joi.string().pattern(RATE_LIMIT_PATTERN).default('3/300'),
  RATE_LIMIT_PROMO_ORDER: Joi.string().pattern(RATE_LIMIT_PATTERN).default('5/60'),
  LOGIN_MAX_FAILED_ATTEMPTS: Joi.number().integer().min(1).max(100).default(5),
  LOGIN_FAILURE_WINDOW_SECONDS: Joi.number().integer().min(60).max(86_400).default(900),
  LOGIN_LOCKOUT_STEPS_SECONDS: Joi.string()
    .pattern(/^[1-9]\d*(,[1-9]\d*)*$/)
    .default('60,300,1800'),
  QUEUE_WORKERS_ENABLED: Joi.boolean().default(true),
  QUEUE_PREFIX: Joi.string()
    .pattern(/^[a-z0-9_-]+$/i)
    .default('bull'),
  QUEUE_BACKOFF_BASE_MS: Joi.number().integer().min(1).max(600_000).default(2000),
  PAYMENT_REMINDER_DELAY_MS: Joi.number()
    .integer()
    .min(1)
    .default(30 * 60 * 1000),
  SMTP_HOST: Joi.string().hostname().default('localhost'),
  SMTP_PORT: Joi.number().port().default(1025),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().allow('').optional(),
  SMTP_PASSWORD: Joi.string().allow('').optional(),
  MAIL_FROM: Joi.string().default('ShopFast <no-reply@shopfast.local>'),
  INVOICE_STORAGE_DIR: Joi.string().default('./storage/invoices'),
  PARTNER_FAILURE_RATE: Joi.number().min(0).max(1).default(0.3),
  PARTNER_LATENCY_MS: Joi.number().integer().min(0).max(60_000).default(200),
  REPORT_TIMEZONE: Joi.string().default('Asia/Ho_Chi_Minh'),
});
