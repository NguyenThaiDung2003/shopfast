import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { rateLimitStore } from '../api/rate-limit';
import { sessionStore } from '../auth/session';

// Mặc định findBy*/waitFor chỉ chờ 1 giây, dễ vỡ khi CPU bị tranh chấp (runner CI).
configure({ asyncUtilTimeout: 5_000 });

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
