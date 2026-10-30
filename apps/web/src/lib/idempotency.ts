import { isApiError } from '../api/errors';

/**
 * Idempotency-Key cho request ghi có rủi ro bấm trùng (POST /orders…): khớp
 * `^[A-Za-z0-9_-]{8,100}$` của API. `crypto.randomUUID` chỉ có trong secure context (https,
 * localhost) – mở web qua IP LAN bằng http thì dùng `getRandomValues`.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Lỗi có thể thử lại với CÙNG key: request có thể đã tới server (mạng đứt sau khi gửi, 5xx,
 * đang xử lý) – gửi lại cùng key thì server trả đúng bản ghi đã tạo thay vì tạo bản thứ hai.
 */
export function keepsIdempotencyKey(error: unknown): boolean {
  if (!isApiError(error)) return true;
  return (
    error.status === 0 ||
    error.status >= 500 ||
    error.status === 429 ||
    error.code === 'IDEMPOTENCY_CONFLICT'
  );
}
