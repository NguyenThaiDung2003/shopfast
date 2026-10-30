import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { rateLimitStore } from '../api/rate-limit';
import { sessionStore } from '../auth/session';

beforeEach(() => {
  // jsdom chưa cài scrollTo (gọi khi đổi trang).
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
  cleanup();
  sessionStore.clear();
  rateLimitStore.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
});
