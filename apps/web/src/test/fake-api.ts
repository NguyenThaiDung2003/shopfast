// Fake API cho test: thay global fetch, nên request vẫn đi qua api/client.ts thật
// (gắn token, chuẩn hoá lỗi, 429…). Không bao giờ gọi server thật.

import { vi } from 'vitest';
import type { Role } from '../auth/roles';
import { sessionStore } from '../auth/session';

export interface FakeRequest {
  method: string;
  /** Đường dẫn sau `/api`, ví dụ `/products`. */
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string>;
}

export type FakeHandler = (req: FakeRequest) => Response | Promise<Response>;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Body lỗi chuẩn của HttpExceptionFilter. */
export function apiError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  return json({ statusCode: status, code, message, details, path: '/', timestamp: '' }, status);
}

/** `routes` theo khoá `"GET /products"`; route không khai báo → 404. */
export function fakeApi(routes: Record<string, FakeHandler>) {
  const requests: FakeRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const req: FakeRequest = {
      method: init.method ?? 'GET',
      path: url.pathname.replace(/^\/api/, ''),
      query: url.searchParams,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: (init.headers ?? {}) as Record<string, string>,
    };
    requests.push(req);
    const handler = routes[`${req.method} ${req.path}`];
    return handler
      ? handler(req)
      : apiError(404, 'NOT_FOUND', 'Không tìm thấy tài nguyên được yêu cầu.');
  });
  vi.stubGlobal('fetch', fetchMock);

  return {
    requests,
    to: (key: string) => requests.filter((r) => `${r.method} ${r.path}` === key),
  };
}

/** Đăng nhập giả: JWT chỉ cần payload đọc được (client không kiểm chữ ký). */
export function loginAs(role: Role, id = `user-${role.toLowerCase()}`): void {
  const payload = btoa(JSON.stringify({ sub: id, role, exp: Math.floor(Date.now() / 1000) + 900 }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  sessionStore.set({ accessToken: `h.${payload}.s`, refreshToken: 'refresh-token' });
}
