import type { RedisOptions } from 'ioredis';

/**
 * REDIS_URL → tuỳ chọn ioredis cho BullMQ (dùng chung cho Queue và Worker – @nestjs/bullmq tạo
 * Worker bằng đúng cấu hình của queue). Không dùng REDIS_CLIENT fail-fast: worker bắt buộc
 * `maxRetriesPerRequest: null`. Redis sập thì lệnh nằm chờ trong offline queue của ioredis và
 * được gửi khi kết nối lại; listener tự giới hạn thời gian chờ để không treo (ADR-0009).
 */
export function queueConnection(url: string): RedisOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number(parsed.pathname.slice(1) || 0),
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
    connectTimeout: 2_000,
    retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
  };
}
