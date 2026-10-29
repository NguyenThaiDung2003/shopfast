import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/exceptions/app.exception';
import type { EnvironmentVariables } from '../../config/env.validation';
import { CacheRepository, VersionBump } from './cache.repository';

/** TTL lệch ngẫu nhiên ±15% để các key nạp cùng lúc không hết hạn cùng lúc. */
export const TTL_JITTER = 0.15;
/** Lock nạp lại key: đủ dài cho một truy vấn DB, đủ ngắn để tự gỡ nếu tiến trình chết. */
export const LOCK_TTL_MS = 2_000;
/** Request không giữ lock chờ tối đa chừng này rồi tự đọc DB. */
export const LOCK_WAIT_MS = 300;
export const LOCK_POLL_MS = 25;
const WARN_INTERVAL_MS = 10_000;

// Không phải JSON hợp lệ → không thể trùng với giá trị thật đã serialize.
const EMPTY_MARKER = '__empty__';

export interface CacheSpec<T> {
  /** Nhóm thống kê hit/miss, ví dụ "product". */
  namespace: string;
  /** Khoá version; đọc TRƯỚC khi đọc DB để giá trị nạp muộn rơi vào version cũ. */
  versionKey: string;
  key: (version: string) => string;
  ttlSeconds: number;
  /** Giá trị "rỗng" được cache với TTL ngắn (mặc định: null). */
  isEmpty?: (value: T) => boolean;
}

export interface NamespaceStats {
  name: string;
  hits: number;
  misses: number;
  hitRate: number;
}

export interface CacheStats {
  enabled: boolean;
  namespaces: NamespaceStats[];
  total: NamespaceStats;
}

/** ttl ± 15%, đơn vị ms. `random` ∈ [0, 1). */
export function withJitter(ttlSeconds: number, random: number = Math.random()): number {
  return Math.max(1, Math.round(ttlSeconds * 1000 * (1 + (random * 2 - 1) * TTL_JITTER)));
}

/** Hash ổn định của một object phẳng: bỏ undefined, sắp xếp key trước khi băm. */
export function hashKey(params: Record<string, unknown>): string {
  const normalized = Object.keys(params)
    .filter((k) => params[k] !== undefined)
    .sort()
    .map((k) => [k, params[k]]);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 16);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cache-aside trên Redis (ADR-0007). Redis chỉ là lớp tăng tốc: mọi lỗi Redis (mất kết nối,
 * timeout) bị nuốt, log cảnh báo và đọc thẳng DB – khách không bao giờ nhận lỗi vì cache.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly enabled: boolean;
  private readonly negativeTtlSeconds: number;
  private bypassUntil = 0;
  private lastWarnAt = 0;

  constructor(
    private readonly cacheRepository: CacheRepository,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.enabled = config.get('CACHE_ENABLED', { infer: true });
    this.negativeTtlSeconds = config.get('CACHE_NEGATIVE_TTL_SECONDS', { infer: true });
  }

  async getOrLoad<T>(spec: CacheSpec<T>, loader: () => Promise<T>): Promise<T> {
    if (!this.enabled || Date.now() < this.bypassUntil) return loader();

    let key: string;
    try {
      const version = (await this.cacheRepository.get(spec.versionKey)) ?? '0';
      key = spec.key(version);
      const cached = await this.cacheRepository.get(key);
      if (cached !== null) {
        this.count(spec.namespace, 'hit');
        return decode<T>(cached);
      }
    } catch (error) {
      this.warn('read', error);
      return loader();
    }

    this.count(spec.namespace, 'miss');
    return this.loadWithLock(spec, key, loader);
  }

  /**
   * Làm mất hiệu lực bằng INCR version. Lệnh được gửi đi ĐỒNG BỘ trong lời gọi (không có await
   * phía trước) nên request đọc đến sau trên cùng kết nối chắc chắn thấy version mới.
   * Thất bại → tạm bỏ qua cache trong `bypassOnFailureMs` để không phục vụ dữ liệu có thể đã cũ.
   */
  invalidate(bumps: VersionBump[], bypassOnFailureMs: number): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    return this.cacheRepository.bumpVersions(bumps).catch((error: unknown) => {
      this.bypassUntil = Math.max(this.bypassUntil, Date.now() + bypassOnFailureMs);
      this.logger.error(
        `Cache invalidation failed, bypassing cache for ${bypassOnFailureMs}ms: ${message(error)}`,
      );
    });
  }

  async getStats(): Promise<CacheStats> {
    const raw = await this.withRedis(() => this.cacheRepository.getStats());
    const byName = new Map<string, { hits: number; misses: number }>();
    for (const [field, value] of Object.entries(raw)) {
      const [name, kind] = field.split(':');
      if (!name || (kind !== 'hit' && kind !== 'miss')) continue;
      const entry = byName.get(name) ?? { hits: 0, misses: 0 };
      entry[kind === 'hit' ? 'hits' : 'misses'] = Number(value);
      byName.set(name, entry);
    }
    const namespaces = [...byName.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, { hits, misses }]) => toStats(name, hits, misses));
    const hits = namespaces.reduce((sum, n) => sum + n.hits, 0);
    const misses = namespaces.reduce((sum, n) => sum + n.misses, 0);
    return { enabled: this.enabled, namespaces, total: toStats('total', hits, misses) };
  }

  async resetStats(): Promise<void> {
    await this.withRedis(() => this.cacheRepository.resetStats());
  }

  /** Chống dồn dập: chỉ một request nạp key từ DB, các request khác chờ ngắn rồi đọc lại. */
  private async loadWithLock<T>(
    spec: CacheSpec<T>,
    key: string,
    loader: () => Promise<T>,
  ): Promise<T> {
    const lockKey = `lock:${key}`;
    const token = randomUUID();
    let locked: boolean;
    try {
      locked = await this.cacheRepository.acquireLock(lockKey, token, LOCK_TTL_MS);
    } catch (error) {
      this.warn('lock', error);
      return loader();
    }

    if (!locked) {
      const waited = await this.waitForValue<T>(key);
      // Hết thời gian chờ (người giữ lock chậm/chết) → tự đọc DB, không ghi đè cache.
      return waited.found ? waited.value : loader();
    }

    try {
      const value = await loader();
      const empty = spec.isEmpty ? spec.isEmpty(value) : value === null;
      const ttlMs = withJitter(empty ? this.negativeTtlSeconds : spec.ttlSeconds);
      await this.cacheRepository.set(key, encode(value), ttlMs).catch((e) => this.warn('write', e));
      return value;
    } finally {
      this.cacheRepository.releaseLock(lockKey, token).catch((e) => this.warn('unlock', e));
    }
  }

  private async waitForValue<T>(
    key: string,
  ): Promise<{ found: true; value: T } | { found: false }> {
    for (let waited = 0; waited < LOCK_WAIT_MS; waited += LOCK_POLL_MS) {
      await sleep(LOCK_POLL_MS);
      try {
        const cached = await this.cacheRepository.get(key);
        if (cached !== null) return { found: true, value: decode<T>(cached) };
      } catch (error) {
        this.warn('read', error);
        return { found: false };
      }
    }
    return { found: false };
  }

  // Fire-and-forget: thống kê không được làm chậm hay hỏng request.
  private count(namespace: string, kind: 'hit' | 'miss'): void {
    this.cacheRepository
      .incrementStat(`${namespace}:${kind}`)
      .catch((error) => this.warn('stats', error));
  }

  /** Redis sập thì mỗi request đều lỗi → chỉ log tối đa một lần mỗi 10 giây. */
  private warn(operation: string, error: unknown): void {
    const now = Date.now();
    if (now - this.lastWarnAt < WARN_INTERVAL_MS) return;
    this.lastWarnAt = now;
    this.logger.warn(`Cache ${operation} failed, falling back to database: ${message(error)}`);
  }

  private async withRedis<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.logger.error(`Redis unavailable for cache stats: ${message(error)}`);
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'CACHE_UNAVAILABLE',
        'Không đọc được thống kê cache vì Redis đang gián đoạn. Vui lòng thử lại sau.',
      );
    }
  }
}

function encode(value: unknown): string {
  return value === null ? EMPTY_MARKER : JSON.stringify(value);
}

function decode<T>(raw: string): T {
  return (raw === EMPTY_MARKER ? null : JSON.parse(raw)) as T;
}

function toStats(name: string, hits: number, misses: number): NamespaceStats {
  const total = hits + misses;
  return {
    name,
    hits,
    misses,
    hitRate: total === 0 ? 0 : Math.round((hits / total) * 10_000) / 10_000,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
