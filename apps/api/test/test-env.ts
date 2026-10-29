import { resolve } from 'node:path';
import { config } from 'dotenv';

/**
 * Nạp .env gốc rồi trỏ app sang DB/Redis dành riêng cho e2e.
 * Dừng ngay nếu URL test trùng URL dev hoặc tên DB không kết thúc bằng _test,
 * vì global-setup sẽ XOÁ SẠCH DB này.
 */
export function loadTestEnv(): { databaseUrl: string; redisUrl: string } {
  config({ path: resolve(__dirname, '../../../.env'), quiet: true });

  const databaseUrl = process.env.TEST_DATABASE_URL;
  const redisUrl = process.env.TEST_REDIS_URL;
  if (!databaseUrl || !redisUrl) {
    throw new Error(
      'Thiếu TEST_DATABASE_URL / TEST_REDIS_URL trong .env (xem .env.example). ' +
        'E2E cần `docker compose up -d postgres redis`.',
    );
  }
  if (
    databaseUrl === process.env.DATABASE_URL ||
    !new URL(databaseUrl).pathname.endsWith('_test')
  ) {
    throw new Error('TEST_DATABASE_URL phải trỏ tới DB riêng có tên kết thúc bằng _test.');
  }
  if (redisUrl === process.env.REDIS_URL) {
    throw new Error('TEST_REDIS_URL phải khác REDIS_URL (dùng DB số khác, ví dụ /1).');
  }
  return { databaseUrl, redisUrl };
}
