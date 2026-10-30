// Chạy trong mỗi worker Jest trước khi import app: trỏ app sang DB/Redis test.
import { loadTestEnv } from './test-env';

const { databaseUrl, redisUrl } = loadTestEnv();

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = databaseUrl;
process.env.REDIS_URL = redisUrl;
// bcrypt cost thấp để test nhanh; production dùng mặc định 12.
process.env.BCRYPT_ROUNDS = '4';
// Test giả IP client bằng X-Forwarded-For như khi đứng sau Nginx (ADR-0008).
process.env.TRUST_PROXY = '1';
// Mọi suite chạy từ cùng 127.0.0.1 và dùng chung Redis test: hạn mức rất cao để không vướng.
// rate-limit.e2e-spec.ts tự hạ hạn mức (test/rate-limit.env.ts).
process.env.RATE_LIMIT_GLOBAL = '100000/60';
process.env.RATE_LIMIT_LOGIN = '100000/60';
process.env.RATE_LIMIT_OTP_SEND = '100000/60';
process.env.RATE_LIMIT_PROMO_ORDER = '100000/60';
process.env.RATE_LIMIT_AI_ASSISTANT = '100000/60';
process.env.RATE_LIMIT_TICKET_CREATE = '100000/60';
// Không bao giờ gọi LLM thật trong test; support.e2e-spec.ts thay provider bằng bản giả có kịch bản.
process.env.LLM_PROVIDER = 'disabled';
// Test gọi app.close() liên tục: không chờ load balancer rút traffic.
process.env.SHUTDOWN_DRAIN_MS = '0';
// Worker BullMQ tắt cho mọi suite (chỉ đẩy job); jobs.e2e-spec.ts tự bật (test/jobs.env.ts).
process.env.QUEUE_WORKERS_ENABLED = 'false';
process.env.QUEUE_PREFIX = 'test';
