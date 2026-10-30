// Trạng thái bị giới hạn tần suất (429, ADR-0008) dùng chung toàn app: API client ghi,
// RateLimitBanner đọc qua useSyncExternalStore.

export interface RateLimitState {
  /** Mốc (ms since epoch) hết bị giới hạn. */
  until: number;
  /** Tổng số giây phải chờ lúc nhận 429 (cho thanh tiến trình). */
  totalSeconds: number;
  /** `TOO_MANY_REQUESTS`, `LOGIN_LOCKED`, `OTP_TOO_MANY_ATTEMPTS`… */
  code: string;
  /** Thông điệp tiếng Việt server trả. */
  message: string;
}

type Listener = () => void;

let state: RateLimitState | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export const rateLimitStore = {
  getSnapshot(): RateLimitState | null {
    return state;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Ghi nhận 429; nếu đang bị giới hạn thì giữ mốc xa hơn. */
  report(retryAfterSeconds: number, code: string, message: string): void {
    const until = Date.now() + retryAfterSeconds * 1000;
    if (state === null || until >= state.until) {
      state = { until, totalSeconds: Math.max(1, retryAfterSeconds), code, message };
      emit();
    }
  },
  clear(): void {
    if (state !== null) {
      state = null;
      emit();
    }
  },
};

/** `Retry-After` dạng số giây hoặc HTTP-date (RFC 9110). */
export function parseRetryAfter(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000));
}
