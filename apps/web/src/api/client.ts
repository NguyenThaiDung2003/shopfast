// HTTP client duy nhất của web: gắn token, tự refresh khi 401, chuẩn hoá lỗi thành ApiError,
// ghi nhận 429 cho RateLimitBanner. Dữ liệu server đọc qua TanStack Query, không gọi fetch trực tiếp.

import { sessionStore, type SessionTokens } from '../auth/session';
import { ApiError, defaultMessage } from './errors';
import { parseRetryAfter, rateLimitStore } from './rate-limit';

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/+$/, '');

/** Refresh chủ động khi access token còn ít hơn ngưỡng này. */
const REFRESH_LEEWAY_MS = 30_000;
/** 429 không có Retry-After lẫn details.retryAfterSeconds. */
const DEFAULT_RETRY_AFTER_SECONDS = 60;

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Object → JSON; FormData gửi nguyên. */
  body?: unknown;
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** `false` cho endpoint công khai không cần gắn token. Mặc định true. */
  auth?: boolean;
}

// ---- Phiên hết hạn -------------------------------------------------------------------------

type ExpiredListener = () => void;
const expiredListeners = new Set<ExpiredListener>();

/** Đăng ký nghe sự kiện "refresh thất bại, đã đăng xuất" (để hiện toast). */
export function onSessionExpired(listener: ExpiredListener): () => void {
  expiredListeners.add(listener);
  return () => expiredListeners.delete(listener);
}

// ---- Refresh token (single-flight) ---------------------------------------------------------

type RefreshResult = 'ok' | 'expired' | 'network';
let refreshing: Promise<RefreshResult> | null = null;

/**
 * Đổi refresh token lấy cặp mới. Refresh token xoay vòng và chỉ dùng được MỘT lần (ADR-0003),
 * nên mọi request 401 cùng lúc phải chờ chung một lần gọi.
 */
export function refreshSession(): Promise<RefreshResult> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function doRefresh(): Promise<RefreshResult> {
  const session = sessionStore.getSnapshot();
  if (!session) return 'expired';
  const used = session.refreshToken;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken: used }),
    });
  } catch {
    return 'network';
  }

  if (response.ok) {
    const tokens = (await response.json()) as SessionTokens;
    return sessionStore.set(tokens) ? 'ok' : 'expired';
  }
  if (response.status === 429 || response.status >= 500) {
    if (response.status === 429) await toApiError(response); // ghi nhận banner
    return 'network';
  }
  // Tab khác vừa refresh (token cũ đã bị thu hồi) → dùng cặp mới của tab đó.
  const latest = sessionStore.getSnapshot();
  if (latest && latest.refreshToken !== used) return 'ok';
  sessionStore.clear();
  expiredListeners.forEach((listener) => listener());
  return 'expired';
}

// ---- Request -------------------------------------------------------------------------------

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

function readRetryAfterDetail(details: unknown): number | null {
  if (typeof details !== 'object' || details === null) return null;
  const value = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return typeof value === 'number' && value >= 0 ? value : null;
}

/** Body chuẩn `{ statusCode, code, message, details }` (HttpExceptionFilter) → ApiError. */
async function toApiError(response: Response): Promise<ApiError> {
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.json();
    if (typeof parsed === 'object' && parsed !== null) body = parsed as Record<string, unknown>;
  } catch {
    // Không phải JSON (proxy trả HTML…): dùng thông điệp mặc định.
  }
  const status = response.status;
  const code = typeof body.code === 'string' ? body.code : `HTTP_${status}`;
  const message =
    typeof body.message === 'string' && body.message ? body.message : defaultMessage(status);

  if (status !== 429) return new ApiError(status, code, message, body.details);

  const retryAfter =
    parseRetryAfter(response.headers.get('Retry-After')) ??
    readRetryAfterDetail(body.details) ??
    DEFAULT_RETRY_AFTER_SECONDS;
  rateLimitStore.report(retryAfter, code, message);
  return new ApiError(status, code, message, body.details, retryAfter);
}

async function send(path: string, options: RequestOptions, token: string | undefined) {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    return await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: options.signal,
    });
  } catch (error) {
    // Huỷ request (TanStack Query huỷ khi rời trang) → để nguyên AbortError.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', defaultMessage(0));
  }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const useAuth = options.auth !== false;

  if (useAuth) {
    const session = sessionStore.getSnapshot();
    if (session && session.user.expiresAt - Date.now() < REFRESH_LEEWAY_MS) {
      await refreshSession();
    }
  }

  let token = useAuth ? sessionStore.getSnapshot()?.accessToken : undefined;
  let response = await send(path, options, token);

  // Access token hết hạn/bị thu hồi → refresh một lần rồi thử lại đúng một lần.
  if (response.status === 401 && token) {
    const result = await refreshSession();
    if (result === 'network') throw new ApiError(0, 'NETWORK_ERROR', defaultMessage(0));
    token = sessionStore.getSnapshot()?.accessToken;
    if (result === 'ok' && token) response = await send(path, options, token);
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('Content-Type') ?? '';
  return (
    contentType.includes('application/json') ? response.json() : response.text()
  ) as Promise<T>;
}

type BodylessOptions = Omit<RequestOptions, 'method' | 'body'>;

export const api = {
  get: <T>(path: string, options?: BodylessOptions) => apiRequest<T>(path, options),
  delete: <T = void>(path: string, options?: BodylessOptions) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
  post: <T>(path: string, body?: unknown, options?: BodylessOptions) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: BodylessOptions) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: BodylessOptions) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
};
