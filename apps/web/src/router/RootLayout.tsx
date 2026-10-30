import { useEffect } from 'react';
import { Outlet, ScrollRestoration } from 'react-router-dom';
import { onSessionExpired } from '../api/client';
import { useToast } from '../components/ui';

/** Gốc mọi route: báo phiên hết hạn (refresh thất bại) và khôi phục vị trí cuộn. */
export function RootLayout() {
  const toast = useToast();

  useEffect(
    () =>
      onSessionExpired(() =>
        toast.show({
          tone: 'warning',
          title: 'Phiên đăng nhập đã hết hạn',
          description: 'Vui lòng đăng nhập lại để tiếp tục.',
        }),
      ),
    [toast],
  );

  return (
    <>
      <Outlet />
      <ScrollRestoration />
    </>
  );
}
