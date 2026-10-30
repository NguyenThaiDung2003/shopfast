import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import type { EnvironmentVariables } from '../../config/env.validation';

/**
 * Socket.IO dùng Redis pub/sub để emit vào room tới được socket ở MỌI instance (blue-green,
 * nhiều replica) – ADR-0010.
 *
 * Kết nối riêng, không dùng REDIS_CLIENT: subscriber phải tự kết nối lại và đăng ký lại kênh.
 * Publisher không xếp hàng khi mất kết nối (pub/sub vốn at-most-once; tin cũ gửi muộn vô ích).
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private readonly redisUrl: string;
  private readonly clients: Redis[] = [];

  constructor(app: INestApplicationContext) {
    super(app);
    this.redisUrl = app
      .get(ConfigService<EnvironmentVariables, true>)
      .get('REDIS_URL', { infer: true });
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    const pubClient = this.createClient('pub', { enableOfflineQueue: false });
    const subClient = this.createClient('sub', {});
    server.adapter(createAdapter(guardPublish(pubClient, this.logger), subClient));
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    const clients = this.clients.splice(0);
    await Promise.all(clients.map((client) => client.quit().catch(() => client.disconnect())));
  }

  private createClient(role: string, options: { enableOfflineQueue?: boolean }): Redis {
    const client = new Redis(this.redisUrl, {
      ...options,
      connectTimeout: 2_000,
      retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
    });
    // Bắt buộc có listener `error`, nếu không ioredis ném ra ngoài khi mất kết nối.
    client.on('error', (error: Error) =>
      this.logger.warn(`Socket.IO Redis ${role} error: ${error.message}`),
    );
    this.clients.push(client);
    return client;
  }
}

/**
 * redis-adapter gọi `pubClient.publish()` mà không bắt lỗi: Redis sập → promise bị từ chối
 * không ai xử lý → Node dừng process. Bọc lại để chỉ log; socket cùng instance vẫn nhận tin.
 */
export function guardPublish(client: Redis, logger: Logger): Redis {
  const publish = client.publish.bind(client) as (
    channel: string | Buffer,
    message: string | Buffer,
  ) => Promise<number>;
  const guarded = (channel: string | Buffer, message: string | Buffer): Promise<number> =>
    publish(channel, message).catch((error: Error) => {
      logger.warn(`Socket.IO broadcast to other instances failed: ${error.message}`);
      return 0;
    });
  Object.assign(client, { publish: guarded });
  return client;
}
