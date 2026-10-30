import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { guardPublish } from './redis-io.adapter';

describe('guardPublish', () => {
  it('publish lỗi (Redis sập) → chỉ log cảnh báo, không để promise bị từ chối lọt ra ngoài', async () => {
    const client = {
      publish: jest.fn().mockRejectedValue(new Error("Stream isn't writeable")),
    };
    const logger = { warn: jest.fn() } as unknown as Logger;

    const guarded = guardPublish(client as unknown as Redis, logger);

    await expect(guarded.publish('socket.io#/#', 'msg')).resolves.toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Stream isn't writeable"));
  });

  it('publish thành công → trả kết quả gốc', async () => {
    const publish = jest.fn().mockResolvedValue(2);

    const guarded = guardPublish({ publish } as unknown as Redis, new Logger('test'));

    await expect(guarded.publish('channel', 'msg')).resolves.toBe(2);
    expect(publish).toHaveBeenCalledWith('channel', 'msg');
  });
});
