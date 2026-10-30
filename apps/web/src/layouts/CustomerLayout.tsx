import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { ROLE_HOME } from '../auth/roles';
import { useSession } from '../auth/useAuth';
import { fetchCart } from '../cart/cart-api';
import { RateLimitBanner } from '../components/RateLimitBanner';
import { Icon } from '../components/ui';
import { cn } from '../lib/cn';
import { cartKeys } from '../products/product-api';
import { Logo } from './Logo';
import { UserMenu } from './UserMenu';

const PUBLIC_NAV: Array<{ to: string; label: string; end?: boolean }> = [
  { to: '/', label: 'Trang chủ', end: true },
  { to: '/san-pham', label: 'Sản phẩm' },
];

/** Chỉ tài khoản khách vào được (nhân viên sẽ gặp 403), người chưa đăng nhập được mời đăng nhập. */
const CUSTOMER_NAV = [
  { to: '/don-hang', label: 'Đơn hàng của tôi' },
  { to: '/ho-tro', label: 'Hỗ trợ' },
];

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'transition-colors',
    isActive
      ? 'text-title-sm text-primary'
      : 'text-body-md text-on-surface-variant hover:text-on-surface',
  );

/** Số món trong giỏ trên icon navbar; chỉ khách hàng mới có giỏ (dùng chung cache với trang giỏ). */
function CartLink() {
  const session = useSession();
  const { data } = useQuery({
    queryKey: cartKeys.all,
    queryFn: ({ signal }) => fetchCart(signal),
    enabled: session?.user.role === 'CUSTOMER',
    staleTime: 60_000,
  });
  const count = session?.user.role === 'CUSTOMER' ? (data?.totalQuantity ?? 0) : 0;
  return (
    <Link
      to="/gio-hang"
      aria-label={count > 0 ? `Giỏ hàng (${count} món)` : 'Giỏ hàng'}
      className="relative flex items-center justify-center rounded-xl p-space-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
    >
      <Icon name="shopping_cart" className="text-2xl" />
      {count > 0 && (
        <span
          className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary-container px-space-xs text-label-sm font-bold text-on-secondary"
          aria-hidden
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

function SearchBox({ className }: { className?: string }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const query = q.trim();
    navigate(query ? `/san-pham?q=${encodeURIComponent(query)}` : '/san-pham');
  };

  return (
    <form
      role="search"
      onSubmit={onSubmit}
      className={cn(
        'flex items-center rounded-full bg-surface-container-low py-space-xs pl-space-lg pr-space-xs focus-within:ring-2 focus-within:ring-primary',
        className,
      )}
    >
      <Icon name="search" className="mr-space-sm text-outline" />
      <input
        value={q}
        onChange={(event) => setQ(event.target.value)}
        type="search"
        aria-label="Tìm kiếm sản phẩm"
        placeholder="Tìm kiếm sản phẩm, thương hiệu…"
        className="w-full min-w-0 bg-transparent text-body-md text-on-surface placeholder:text-outline focus:outline-none"
      />
      <button
        type="submit"
        className="shrink-0 rounded-full bg-secondary-container px-space-lg py-space-sm text-label-md text-on-secondary transition-colors hover:bg-secondary"
      >
        Tìm kiếm
      </button>
    </form>
  );
}

/** Layout khách hàng: navbar cố định 2 tầng (thiết kế "Trang chủ", "Đơn hàng của tôi"). */
export function CustomerLayout() {
  const session = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const role = session?.user.role;
  const isStaff = role !== undefined && role !== 'CUSTOMER';
  const nav: typeof PUBLIC_NAV = [
    ...PUBLIC_NAV,
    ...(isStaff ? [{ to: ROLE_HOME[role], label: 'Trang quản trị' }] : CUSTOMER_NAV),
  ];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="fixed inset-x-0 top-0 z-40 bg-surface-container-lowest/95 shadow-header backdrop-blur-xl">
        <div className="mx-auto max-w-content px-margin-mobile md:px-margin lg:px-12">
          <div className="flex h-16 items-center justify-between gap-space-lg">
            <div className="flex shrink-0 items-center gap-space-sm">
              <button
                type="button"
                className="rounded-lg p-space-xs text-on-surface-variant hover:bg-surface-container-high xl:hidden"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Mở menu"
                aria-expanded={menuOpen}
              >
                <Icon name={menuOpen ? 'close' : 'menu'} />
              </button>
              <Logo />
            </div>

            <SearchBox className="mx-space-md hidden max-w-2xl flex-1 md:flex" />

            <div className="flex shrink-0 items-center gap-space-lg">
              <nav
                aria-label="Điều hướng chính"
                className="hidden items-center gap-space-lg xl:flex"
              >
                {nav.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
                    {item.label}
                  </NavLink>
                ))}
              </nav>
              {!isStaff && <CartLink />}
              <div className="border-l border-outline-variant/30 pl-space-sm">
                {session ? (
                  <UserMenu afterLogout="/" />
                ) : (
                  <Link
                    to="/dang-nhap"
                    className="inline-flex h-9 items-center rounded-lg bg-primary-container px-space-lg text-title-sm text-on-primary transition-colors hover:bg-primary"
                  >
                    Đăng nhập
                  </Link>
                )}
              </div>
            </div>
          </div>

          <div className="flex h-10 items-center justify-between border-t border-surface-container-high text-body-sm text-on-surface-variant">
            <Link
              to="/san-pham"
              className="flex items-center gap-space-xs font-medium hover:text-primary"
            >
              <Icon name="menu" className="text-base" />
              Tất cả sản phẩm
            </Link>
            <span className="hidden items-center gap-space-xs lg:flex">
              <Icon name="local_shipping" className="text-base text-tertiary-container" />
              Giao nhanh 2H miễn phí
            </span>
          </div>
        </div>

        {menuOpen && (
          <div className="border-t border-surface-container-high bg-surface-container-lowest px-margin-mobile py-space-md xl:hidden">
            <SearchBox className="mb-space-md md:hidden" />
            <nav aria-label="Điều hướng chính" className="flex flex-col gap-space-md">
              {nav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={navClass}
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
        )}
      </header>

      <main className="w-full flex-1 pt-28">
        <div className="mx-auto max-w-content space-y-space-lg px-margin-mobile py-space-xl md:px-margin lg:px-12">
          <RateLimitBanner />
          <Outlet />
        </div>
      </main>

      <footer className="border-t border-surface-container-high bg-surface-container-lowest">
        <div className="mx-auto flex max-w-content flex-wrap items-center justify-between gap-space-md px-margin-mobile py-space-xl text-body-sm text-on-surface-variant md:px-margin lg:px-12">
          <p>© {new Date().getFullYear()} ShopFast Việt Nam.</p>
          {!isStaff && (
            <nav aria-label="Liên kết cuối trang" className="flex gap-space-lg">
              <Link to="/ho-tro" className="hover:text-primary">
                Trung tâm hỗ trợ
              </Link>
              <Link to="/don-hang" className="hover:text-primary">
                Tra cứu đơn hàng
              </Link>
            </nav>
          )}
        </div>
      </footer>
    </div>
  );
}
