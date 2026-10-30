import { api } from '../api/client';
import type { Role } from './roles';
import { sessionStore, type SessionTokens } from './session';

/** Khớp UserDto của API (không bao giờ có passwordHash). */
export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  createdAt: string;
}

export interface AuthResult extends SessionTokens {
  tokenType: 'Bearer';
  expiresIn: number;
  user: User;
}

export interface LoginInput {
  email: string;
  password: string;
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const result = await api.post<AuthResult>('/auth/login', input, { auth: false });
  sessionStore.set(result);
  return result;
}

/** Thu hồi phiên của refresh token hiện tại; lỗi mạng vẫn đăng xuất phía client. */
export async function logout(): Promise<void> {
  const refreshToken = sessionStore.getSnapshot()?.refreshToken;
  sessionStore.clear();
  if (!refreshToken) return;
  await api.post<void>('/auth/logout', { refreshToken }, { auth: false }).catch(() => undefined);
}

export function fetchMe(signal?: AbortSignal): Promise<User> {
  return api.get<User>('/auth/me', { signal });
}
