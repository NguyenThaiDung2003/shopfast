import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import { CacheRepository, VersionBump } from './cache.repository';
import {
  CacheService,
  CacheSpec,
  hashKey,
  LOCK_TTL_MS,
  LOCK_WAIT_MS,
  withJitter,
} from './cache.service';

/** Redis giả trong bộ nhớ, đủ các lệnh CacheRepository dùng. */
class FakeCacheRepository {
  readonly store = new Map<string, string>();
  readonly ttls = new Map<string, number>();
  readonly stats = new Map<string, number>();

  get = jest.fn(async (key: string) => this.store.get(key) ?? null);
  set = jest.fn(async (key: string, value: string, ttlMs: number) => {
    this.store.set(key, value);
    this.ttls.set(key, ttlMs);
  });
  acquireLock = jest.fn(async (key: string, token: string) => {
    if (this.store.has(key)) return false;
    this.store.set(key, token);
    return true;
  });
  releaseLock = jest.fn(async (key: string, token: string) => {
    if (this.store.get(key) === token) this.store.delete(key);
  });
  bumpVersions = jest.fn(async (bumps: VersionBump[]) => {
    for (const { versionKey, entryPrefix } of bumps) {
      const version = this.store.get(versionKey) ?? '0';
      if (entryPrefix) this.store.delete(entryPrefix + version);
      this.store.set(versionKey, String(Number(version) + 1));
    }
  });
  incrementStat = jest.fn(async (field: string) => {
    this.stats.set(field, (this.stats.get(field) ?? 0) + 1);
  });
  getStats = jest.fn(async () =>
    Object.fromEntries([...this.stats].map(([k, v]) => [k, String(v)])),
  );
  resetStats = jest.fn(async () => this.stats.clear());
}

const PRODUCT_TTL = 300;
const NEGATIVE_TTL = 30;

function config(
  overrides: Record<string, unknown> = {},
): ConfigService<EnvironmentVariables, true> {
  const values: Record<string, unknown> = {
    CACHE_ENABLED: true,
    CACHE_NEGATIVE_TTL_SECONDS: NEGATIVE_TTL,
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<
    EnvironmentVariables,
    true
  >;
}

const spec: CacheSpec<{ id: number; price: number } | null> = {
  namespace: 'product',
  versionKey: 'ver:1',
  key: (version) => `product:1:v${version}`,
  ttlSeconds: PRODUCT_TTL,
};

const flush = () => new Promise((resolve) => setImmediate(resolve));
const redisDown = () => Promise.reject(new Error('Command timed out'));

describe('CacheService', () => {
  let repo: FakeCacheRepository;
  let service: CacheService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    repo = new FakeCacheRepository();
    service = new CacheService(repo as unknown as CacheRepository, config());
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('cache-aside', () => {
    it('trượt → đọc DB một lần, ghi cache có TTL jitter; lần 2 trúng, không gọi DB', async () => {
      const loader = jest.fn().mockResolvedValue({ id: 1, price: 100 });

      await expect(service.getOrLoad(spec, loader)).resolves.toEqual({ id: 1, price: 100 });
      await expect(service.getOrLoad(spec, loader)).resolves.toEqual({ id: 1, price: 100 });

      expect(loader).toHaveBeenCalledTimes(1);
      const ttl = repo.ttls.get('product:1:v0')!;
      expect(ttl).toBeGreaterThanOrEqual(PRODUCT_TTL * 1000 * 0.85);
      expect(ttl).toBeLessThanOrEqual(PRODUCT_TTL * 1000 * 1.15);
      expect(repo.store.has('lock:product:1:v0')).toBe(false); // lock đã nhả
    });

    it('khoá theo version hiện tại', async () => {
      repo.store.set('ver:1', '7');

      await service.getOrLoad(spec, async () => ({ id: 1, price: 1 }));

      expect(repo.store.has('product:1:v7')).toBe(true);
    });

    it('sau khi INCR version → key cũ không còn được đọc, nạp lại giá mới', async () => {
      await service.getOrLoad(spec, async () => ({ id: 1, price: 100 }));

      await service.invalidate([{ versionKey: 'ver:1', entryPrefix: 'product:1:v' }], 1000);

      expect(repo.store.has('product:1:v0')).toBe(false);
      await expect(service.getOrLoad(spec, async () => ({ id: 1, price: 90 }))).resolves.toEqual({
        id: 1,
        price: 90,
      });
    });

    it('request đọc DB trước khi invalidation rồi ghi muộn → rơi vào version cũ, không ai đọc', async () => {
      let release!: () => void;
      const slowStale = jest.fn(
        () =>
          new Promise<{ id: number; price: number }>((resolve) => {
            release = () => resolve({ id: 1, price: 100 }); // giá cũ
          }),
      );
      const pending = service.getOrLoad(spec, slowStale);
      await flush();

      await service.invalidate([{ versionKey: 'ver:1' }], 1000);
      release();
      await pending;

      const fresh = jest.fn().mockResolvedValue({ id: 1, price: 90 });
      await expect(service.getOrLoad(spec, fresh)).resolves.toEqual({ id: 1, price: 90 });
      expect(fresh).toHaveBeenCalledTimes(1);
    });
  });

  describe('giá trị rỗng (chống dò khoá không tồn tại)', () => {
    it('null được cache với TTL ngắn; đọc lại trả null, không gọi DB', async () => {
      const loader = jest.fn().mockResolvedValue(null);

      await expect(service.getOrLoad(spec, loader)).resolves.toBeNull();
      await expect(service.getOrLoad(spec, loader)).resolves.toBeNull();

      expect(loader).toHaveBeenCalledTimes(1);
      expect(repo.ttls.get('product:1:v0')).toBeLessThanOrEqual(NEGATIVE_TTL * 1000 * 1.15);
    });

    it('isEmpty tuỳ biến: trang rỗng cache TTL ngắn nhưng vẫn giữ nguyên giá trị', async () => {
      const listSpec: CacheSpec<{ items: number[] }> = {
        ...spec,
        key: () => 'list',
        isEmpty: (page) => page.items.length === 0,
      };

      await service.getOrLoad(listSpec, async () => ({ items: [] }));

      expect(repo.ttls.get('list')).toBeLessThanOrEqual(NEGATIVE_TTL * 1000 * 1.15);
      await expect(service.getOrLoad(listSpec, jest.fn())).resolves.toEqual({ items: [] });
    });
  });

  describe('chống dồn dập (lock SET NX PX)', () => {
    it('20 request đồng thời vào key nguội → chỉ 1 lần đọc DB', async () => {
      const loader = jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { id: 1, price: 100 };
      });

      const results = await Promise.all(
        Array.from({ length: 20 }, () => service.getOrLoad(spec, loader)),
      );

      expect(loader).toHaveBeenCalledTimes(1);
      expect(results.every((r) => r?.price === 100)).toBe(true);
      expect(repo.acquireLock).toHaveBeenCalledWith(
        'lock:product:1:v0',
        expect.any(String),
        LOCK_TTL_MS,
      );
    });

    it('người giữ lock quá chậm → hết thời gian chờ thì tự đọc DB, không ghi cache', async () => {
      repo.store.set('lock:product:1:v0', 'other-instance');
      const loader = jest.fn().mockResolvedValue({ id: 1, price: 100 });
      const started = Date.now();

      await expect(service.getOrLoad(spec, loader)).resolves.toEqual({ id: 1, price: 100 });

      expect(Date.now() - started).toBeGreaterThanOrEqual(LOCK_WAIT_MS - 50);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(repo.set).not.toHaveBeenCalled();
      expect(repo.store.get('lock:product:1:v0')).toBe('other-instance'); // không xoá lock của người khác
    });

    it('DB lỗi → nhả lock và ném lỗi gốc', async () => {
      await expect(
        service.getOrLoad(spec, () => Promise.reject(new Error('db down'))),
      ).rejects.toThrow('db down');
      expect(repo.store.has('lock:product:1:v0')).toBe(false);
    });
  });

  describe('Redis lỗi/timeout → đọc DB, không ném lỗi', () => {
    const value = { id: 1, price: 100 };

    it.each(['get', 'acquireLock', 'set', 'releaseLock', 'incrementStat'] as const)(
      '%s lỗi → vẫn trả dữ liệu từ DB',
      async (method) => {
        repo[method].mockImplementation(redisDown);
        const loader = jest.fn().mockResolvedValue(value);

        await expect(service.getOrLoad(spec, loader)).resolves.toEqual(value);
        await flush();

        expect(loader).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Command timed out'));
      },
    );

    it('lỗi lúc chờ lock → đọc DB ngay', async () => {
      repo.store.set('lock:product:1:v0', 'other');
      repo.get
        .mockImplementationOnce(async () => null) // version
        .mockImplementationOnce(async () => null) // key
        .mockImplementation(redisDown);
      const loader = jest.fn().mockResolvedValue(value);

      await expect(service.getOrLoad(spec, loader)).resolves.toEqual(value);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('Redis sập → cảnh báo bị giới hạn, không ngập log', async () => {
      repo.get.mockImplementation(redisDown);

      for (let i = 0; i < 5; i++) await service.getOrLoad(spec, async () => value);

      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('invalidation lỗi → tạm bỏ qua cache để không phục vụ giá cũ', async () => {
      await service.getOrLoad(spec, async () => ({ id: 1, price: 100 }));
      repo.bumpVersions.mockImplementationOnce(redisDown);

      await expect(service.invalidate([{ versionKey: 'ver:1' }], 60_000)).resolves.toBeUndefined();

      const loader = jest.fn().mockResolvedValue({ id: 1, price: 90 });
      await expect(service.getOrLoad(spec, loader)).resolves.toEqual({ id: 1, price: 90 });
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('hết thời gian bỏ qua → dùng cache lại', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      repo.bumpVersions.mockImplementationOnce(redisDown);
      await service.invalidate([{ versionKey: 'ver:1' }], 5_000);

      now.mockReturnValue(1_006_000);
      await service.getOrLoad(spec, async () => value);

      expect(repo.get).toHaveBeenCalled();
    });
  });

  it('CACHE_ENABLED=false → luôn đọc DB, không chạm Redis', async () => {
    service = new CacheService(
      repo as unknown as CacheRepository,
      config({ CACHE_ENABLED: false }),
    );
    const loader = jest.fn().mockResolvedValue(null);

    await service.getOrLoad(spec, loader);
    await service.getOrLoad(spec, loader);
    await service.invalidate([{ versionKey: 'ver:1' }], 1000);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(repo.get).not.toHaveBeenCalled();
    expect(repo.bumpVersions).not.toHaveBeenCalled();
  });

  describe('thống kê hit/miss', () => {
    it('đếm theo nhóm và tính tỉ lệ trúng', async () => {
      const loader = async () => ({ id: 1, price: 1 });
      for (let i = 0; i < 4; i++) await service.getOrLoad(spec, loader); // 1 miss + 3 hit
      await service.getOrLoad({ ...spec, namespace: 'product_list', key: () => 'l' }, loader);
      await flush();

      await expect(service.getStats()).resolves.toEqual({
        enabled: true,
        namespaces: [
          { name: 'product', hits: 3, misses: 1, hitRate: 0.75 },
          { name: 'product_list', hits: 0, misses: 1, hitRate: 0 },
        ],
        total: { name: 'total', hits: 3, misses: 2, hitRate: 0.6 },
      });
    });

    it('chưa có lượt đọc → hitRate 0; reset xoá bộ đếm', async () => {
      await service.getOrLoad(spec, async () => null);
      await flush();
      await service.resetStats();

      await expect(service.getStats()).resolves.toMatchObject({
        namespaces: [],
        total: { hits: 0, misses: 0, hitRate: 0 },
      });
    });

    it('bỏ qua trường lạ trong hash thống kê', async () => {
      repo.getStats.mockResolvedValue({ 'product:hit': '2', garbage: '9', 'x:other': '1' });

      await expect(service.getStats()).resolves.toMatchObject({
        namespaces: [{ name: 'product', hits: 2, misses: 0, hitRate: 1 }],
      });
    });

    it('Redis lỗi khi đọc thống kê → 503 CACHE_UNAVAILABLE', async () => {
      repo.getStats.mockImplementation(redisDown);
      repo.resetStats.mockImplementation(redisDown);

      await expect(service.getStats()).rejects.toMatchObject({ code: 'CACHE_UNAVAILABLE' });
      await expect(service.resetStats()).rejects.toMatchObject({ code: 'CACHE_UNAVAILABLE' });
    });
  });
});

describe('withJitter', () => {
  it('nằm trong ±15% và đổi sang ms', () => {
    expect(withJitter(100, 0)).toBe(85_000);
    expect(withJitter(100, 0.5)).toBe(100_000);
    expect(withJitter(100, 0.999_999)).toBe(115_000);
  });
});

describe('hashKey', () => {
  it('không phụ thuộc thứ tự key, bỏ qua undefined', () => {
    expect(hashKey({ a: 1, b: 2, c: undefined })).toBe(hashKey({ b: 2, a: 1 }));
    expect(hashKey({ a: 1 })).not.toBe(hashKey({ a: 2 }));
    expect(hashKey({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
  });
});
