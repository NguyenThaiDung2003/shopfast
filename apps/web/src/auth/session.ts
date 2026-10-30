// Phiên đăng nhập phía trình duyệt (ADR-0003: access JWT ngắn hạn + refresh token xoay vòng).
//
// Token lưu localStorage để giữ đăng nhập qua reload và đồng bộ giữa các tab. Đánh đổi: bị đọc
// được nếu trang dính XSS (API hiện trả token trong body, chưa có cookie httpOnly).
// Vai trò đọc từ payload JWT CHỈ để điều hướng UI – quyền thật luôn do API kiểm.

import { isRole, type Role } from './roles';

const STORAGE_KEY = 'shopfast.session';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export interface SessionUser {
  id: string;
  role: Role;
  /** Hết hạn access token (ms since epoch). */
  expiresAt: number;
}

export interface Session extends SessionTokens {
  user: SessionUser;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let current: Session | null = load();

/** Giải mã payload JWT (không kiểm chữ ký – việc đó của server). Trả null nếu token hỏng. */
export function decodeAccessToken(token: string): SessionUser | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = new TextDecoder().decode(
      Uint8Array.from(
        atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')),
        (c) => c.charCodeAt(0),
      ),
    );
    const payload: unknown = JSON.parse(json);
    if (typeof payload !== 'object' || payload === null) return null;
    const { sub, role, exp } = payload as Record<string, unknown>;
    if (typeof sub !== 'string' || !isRole(role) || typeof exp !== 'number') return null;
    return { id: sub, role, expiresAt: exp * 1000 };
  } catch {
    return null;
  }
}

function toSession(tokens: SessionTokens): Session | null {
  const user = decodeAccessToken(tokens.accessToken);
  return user && tokens.refreshToken ? { ...tokens, user } : null;
}

function load(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionTokens>;
    if (typeof parsed.accessToken !== 'string' || typeof parsed.refreshToken !== 'string') {
      return null;
    }
    return toSession({ accessToken: parsed.accessToken, refreshToken: parsed.refreshToken });
  } catch {
    return null;
  }
}

function persist(session: Session | null): void {
  try {
    if (session) {
      const { accessToken, refreshToken } = session;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ accessToken, refreshToken }));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Trình duyệt chặn storage (chế độ riêng tư…): phiên chỉ sống trong tab hiện tại.
  }
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

export const sessionStore = {
  getSnapshot(): Session | null {
    return current;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Lưu cặp token mới (đăng nhập, refresh). Token không giải mã được → coi như đăng xuất. */
  set(tokens: SessionTokens): Session | null {
    current = toSession(tokens);
    persist(current);
    emit();
    return current;
  },
  clear(): void {
    if (current === null) return;
    current = null;
    persist(null);
    emit();
  },
};

// Tab khác đăng nhập/đăng xuất/refresh → cập nhật tab này.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    current = load();
    emit();
  });
}
