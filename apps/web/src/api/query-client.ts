import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './errors';

/** Lỗi 4xx (dữ liệu/quyền) thử lại vô ích; chỉ thử lại 1 lần với lỗi mạng/5xx. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: shouldRetry,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});
