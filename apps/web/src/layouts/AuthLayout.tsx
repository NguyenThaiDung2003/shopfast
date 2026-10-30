import { Link, Outlet } from 'react-router-dom';
import { Icon } from '../components/ui';
import { Logo } from './Logo';

/** Layout màn xác thực (đăng nhập, OTP): header gọn, nội dung giữa trang. */
export function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="bg-surface-container-lowest shadow-header">
        <div className="mx-auto flex h-16 max-w-content items-center justify-between px-margin-mobile md:px-margin">
          <Logo />
          <Link
            to="/"
            className="flex items-center gap-space-xs text-body-md text-on-surface-variant transition-colors hover:text-primary"
          >
            <Icon name="storefront" className="text-lg" />
            Tiếp tục mua sắm
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-content flex-1 px-margin-mobile py-space-xl md:px-margin">
        <Outlet />
      </main>
      <footer className="py-space-lg text-center text-body-sm text-on-surface-variant">
        © {new Date().getFullYear()} ShopFast Việt Nam.
      </footer>
    </div>
  );
}
