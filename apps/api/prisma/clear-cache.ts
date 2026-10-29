import Redis from 'ioredis';

/**
 * Xoá mọi key `cache:*` (cache catalog, ADR-0007) – dùng sau seed và trước khi đo hiệu năng.
 * Redis không có hoặc lỗi thì chỉ cảnh báo.
 */
export async function clearCatalogCache(url: string | undefined): Promise<void> {
  if (!url) return;
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    let removed = 0;
    for await (const keys of redis.scanStream({ match: 'cache:*', count: 500 })) {
      const batch = keys as string[];
      if (batch.length > 0) removed += await redis.unlink(...batch);
    }
    console.log(`Đã xoá ${removed} key cache catalog.`);
  } catch (error) {
    console.warn(
      `Không xoá được cache (${(error as Error).message}) – có thể còn dữ liệu cũ tới khi hết TTL.`,
    );
  } finally {
    redis.disconnect();
  }
}
