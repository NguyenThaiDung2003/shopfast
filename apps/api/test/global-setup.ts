import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { loadTestEnv } from './test-env';

/**
 * Chạy một lần trước toàn bộ e2e: áp migration lên DB test rồi làm trống dữ liệu.
 * Dùng `migrate deploy` + TRUNCATE (không dùng `migrate reset`) để nhanh và chạy được trong CI.
 * loadTestEnv() đã đảm bảo DB đích là DB riêng có tên *_test.
 */
export default async function globalSetup(): Promise<void> {
  const { databaseUrl, redisUrl } = loadTestEnv();

  execSync('npx prisma migrate deploy', {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    if (tables.length > 0) {
      const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await prisma.$disconnect();
  }

  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await redis.connect();
  await redis.flushdb();
  redis.disconnect();
}
