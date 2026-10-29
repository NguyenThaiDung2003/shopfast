// Chạy trong mỗi worker Jest trước khi import app: trỏ app sang DB/Redis test.
import { loadTestEnv } from './test-env';

const { databaseUrl, redisUrl } = loadTestEnv();

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = databaseUrl;
process.env.REDIS_URL = redisUrl;
// bcrypt cost thấp để test nhanh; production dùng mặc định 12.
process.env.BCRYPT_ROUNDS = '4';
