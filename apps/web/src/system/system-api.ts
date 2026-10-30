import { api } from '../api/client';
import { isApiError } from '../api/errors';

export type HealthStatus = 'ok' | 'degraded' | 'error' | 'shutting_down';

/** Khớp DependencyCheckDto. */
export interface DependencyCheck {
  status: 'up' | 'down';
  latencyMs: number;
}

export interface DependencyChecks {
  database: DependencyCheck;
  redis: DependencyCheck;
}

/** ReadinessDto, hoặc `details` của 503 (khi đó không có uptime/timestamp). */
export interface HealthReport {
  status: HealthStatus;
  checks: DependencyChecks;
  uptimeSeconds?: number;
  timestamp?: string;
}

/** Khớp CacheNamespaceStatsDto. */
export interface CacheNamespaceStats {
  name: string;
  hits: number;
  misses: number;
  hitRate: number;
}

/** Khớp CacheStatsDto. */
export interface CacheStats {
  enabled: boolean;
  namespaces: CacheNamespaceStats[];
  total: CacheNamespaceStats;
}

/** Khớp QueueStatsDto. */
export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
}

/** Khớp SystemVersionDto. */
export interface SystemVersion {
  version: string;
  commit: string;
  environment: string;
  nodeVersion: string;
}

/** Bull Board nằm ngoài `/api`, mở trên cùng origin với web (ADR-0009). */
export const BULL_BOARD_URL = '/admin/queues';

export const systemKeys = {
  all: ['system'] as const,
  health: ['system', 'health'] as const,
  cache: ['system', 'cache'] as const,
  queues: ['system', 'queues'] as const,
  version: ['system', 'version'] as const,
};

function isHealthDetails(details: unknown): details is Pick<HealthReport, 'status' | 'checks'> {
  return typeof details === 'object' && details !== null && 'checks' in details;
}

/** 503 có `details.checks` vẫn là một báo cáo: trang cần biết thành phần nào đang lỗi. */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthReport> {
  try {
    return await api.get<HealthReport>('/health', { root: true, auth: false, signal });
  } catch (error) {
    if (isApiError(error) && error.status === 503 && isHealthDetails(error.details)) {
      return error.details;
    }
    throw error;
  }
}

export function fetchCacheStats(signal?: AbortSignal): Promise<CacheStats> {
  return api.get<CacheStats>('/admin/cache/stats', { signal });
}

export function resetCacheStats(): Promise<void> {
  return api.delete('/admin/cache/stats');
}

export async function fetchQueueStats(signal?: AbortSignal): Promise<QueueStats[]> {
  const { queues } = await api.get<{ queues: QueueStats[] }>('/admin/queues/stats', { signal });
  return queues;
}

export function fetchVersion(signal?: AbortSignal): Promise<SystemVersion> {
  return api.get<SystemVersion>('/admin/system/version', { signal });
}

/** Đặt cookie phiên để trình duyệt mở được Bull Board (không gửi được Bearer khi điều hướng). */
export function openQueueSession(): Promise<void> {
  return api.post('/admin/queues/session');
}
