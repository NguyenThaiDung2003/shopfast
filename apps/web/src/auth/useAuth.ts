import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { fetchMe, login, logout, type LoginInput } from './auth-api';
import { sessionStore } from './session';

export const meQueryKey = ['auth', 'me'] as const;

/** Phiên hiện tại (đọc từ JWT, không gọi API). */
export function useSession() {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot);
}

/** Hồ sơ người dùng (họ tên, email) – chỉ gọi khi đã đăng nhập. */
export function useMe() {
  const session = useSession();
  return useQuery({
    queryKey: [...meQueryKey, session?.user.id],
    queryFn: ({ signal }) => fetchMe(signal),
    enabled: session !== null,
    staleTime: 5 * 60_000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => login(input),
    onSuccess: (result) => {
      queryClient.clear();
      queryClient.setQueryData([...meQueryKey, result.user.id], result.user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSettled: () => queryClient.clear(),
  });
}
