// Trang "Giám sát hệ thống": nhãn/màu theo số liệu API và chu kỳ làm mới – logic thuần.

import type { BadgeTone } from '../components/ui';
import type { DependencyCheck, HealthStatus, QueueStats } from './system-api';

export const OVERALL_STATUS: Record<HealthStatus, { label: string; tone: BadgeTone }> = {
  ok: { label: 'Tất cả hệ thống ổn định', tone: 'success' },
  degraded: { label: 'Hệ thống đang suy giảm', tone: 'warning' },
  error: { label: 'Hệ thống gặp sự cố', tone: 'danger' },
  shutting_down: { label: 'Dịch vụ đang tắt để cập nhật', tone: 'warning' },
};

/** `required`: DB lỗi là mất dịch vụ; Redis lỗi chỉ suy giảm (ADR-0012). */
export function dependencyView(
  check: DependencyCheck,
  required: boolean,
): { label: string; tone: BadgeTone; icon: string } {
  if (check.status === 'up') return { label: 'Hoạt động', tone: 'success', icon: 'check_circle' };
  return required
    ? { label: 'Mất kết nối', tone: 'danger', icon: 'error' }
    : { label: 'Suy giảm', tone: 'warning', icon: 'warning' };
}

const QUEUE_DESCRIPTION: Record<string, string> = {
  email: 'Gửi email xác nhận đơn, nhắc thanh toán, báo cáo doanh thu',
  invoice: 'Tạo hoá đơn PDF cho đơn đã thanh toán',
  'inventory-sync': 'Đồng bộ giữ/hoàn tồn kho với đối tác',
  'ticket-classify': 'Phân loại ticket hỗ trợ bằng AI',
  'dead-letter': 'Tác vụ đã hết lượt thử, chờ xử lý thủ công',
};

export function queueDescription(name: string): string | undefined {
  return QUEUE_DESCRIPTION[name];
}

const CACHE_NAMESPACE_LABEL: Record<string, string> = {
  product: 'Chi tiết sản phẩm',
  product_list: 'Danh sách sản phẩm',
  categories: 'Danh mục',
  brands: 'Thương hiệu',
};

/** Tên nhóm cache mới chưa có nhãn thì hiện tên gốc. */
export const cacheNamespaceLabel = (name: string) => CACHE_NAMESPACE_LABEL[name] ?? name;

export const isDeadLetter = (queue: Pick<QueueStats, 'name'>) => queue.name === 'dead-letter';

/** Job còn nằm ở dead-letter (đang chờ) cũng là lỗi cần xử lý. */
export function queueProblemCount(queue: QueueStats): number {
  return isDeadLetter(queue) ? queue.waiting + queue.failed : queue.failed;
}

/** Mục tiêu tỷ lệ trúng cache theo thiết kế. */
export const CACHE_TARGET = 0.85;

/** Chưa có lượt đọc thì không đánh giá. */
export function cacheRateTone(rate: number, reads: number): BadgeTone {
  if (reads === 0) return 'neutral';
  return rate >= CACHE_TARGET ? 'success' : 'warning';
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
}

/** `45 giây`, `12 phút`, `3 giờ 5 phút`, `2 ngày 4 giờ`. */
export function formatUptime(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds} giây`;
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  if (days > 0) return `${days} ngày ${hours} giờ`;
  if (hours > 0) return `${hours} giờ ${minutes} phút`;
  return `${minutes} phút`;
}

export const REFRESH_OPTIONS = [
  { value: '10', label: '10 giây' },
  { value: '30', label: '30 giây' },
  { value: '60', label: '60 giây' },
  { value: 'off', label: 'Tắt' },
] as const;

export const DEFAULT_REFRESH = '10';

/** `?refresh=` trên URL; giá trị sai về mặc định. */
export function parseRefresh(raw: string | null): string {
  return REFRESH_OPTIONS.some((option) => option.value === raw) ? raw! : DEFAULT_REFRESH;
}

/** Chu kỳ cho `refetchInterval` của TanStack Query; `false` = tắt. */
export function refreshInterval(value: string): number | false {
  return value === 'off' ? false : Number(value) * 1000;
}
