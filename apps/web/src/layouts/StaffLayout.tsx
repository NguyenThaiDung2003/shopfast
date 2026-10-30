import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useMatches } from 'react-router-dom';
import { ROLE_LABEL } from '../auth/roles';
import { useSession } from '../auth/useAuth';
import { RateLimitBanner } from '../components/RateLimitBanner';
import { Icon } from '../components/ui';
import { cn } from '../lib/cn';
import { staffNavFor } from '../router/staff-nav';
import { UserMenu } from './UserMenu';

export interface RouteHandle {
  /** Tiêu đề hiện trên topbar (breadcrumb). */
  title?: string;
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const session = useSession();
  if (!session) return null;
  const items = staffNavFor(session.user.role);

  return (
    <div className="flex h-full flex-col bg-surface-container-low">
      <div className="flex h-16 items-center gap-space-sm px-space-lg">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-container text-title-sm font-bold text-on-primary">
          SF
        </div>
        <div>
          <div className="text-title-sm leading-tight text-on-surface">ShopFast</div>
          <div className="text-label-sm font-bold uppercase tracking-wider text-secondary">
            {ROLE_LABEL[session.user.role]}
          </div>
        </div>
      </div>

      <nav
        aria-label="Điều hướng quản trị"
        className="mt-space-xs flex flex-1 flex-col gap-space-xs px-space-sm"
      >
        {items.map((item) => (
          <NavLink
            key={item.path}
            to={`/quan-tri/${item.path}`}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-space-sm rounded-lg px-space-md py-2.5 transition-colors',
                isActive
                  ? 'bg-primary-container text-title-sm text-on-primary shadow-card'
                  : 'text-body-md text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
              )
            }
          >
            <Icon name={item.icon} className="text-xl" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="bg-surface-container p-space-md">
        <NavLink
          to="/"
          className="flex items-center gap-space-sm rounded-lg px-space-md py-space-sm text-body-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
        >
          <Icon name="storefront" className="text-lg" />
          Xem cửa hàng
        </NavLink>
      </div>
    </div>
  );
}

/** Layout nhân viên: sidebar trái cố định + topbar (thiết kế "Quản lý đơn hàng kho"). */
export function StaffLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const matches = useMatches();
  const title = [...matches].reverse().find((m) => (m.handle as RouteHandle | undefined)?.title)
    ?.handle as RouteHandle | undefined;

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 shadow-header lg:block">
        <Sidebar />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-scrim"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 w-64 shadow-modal">
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:ml-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-space-md bg-surface-container-lowest/95 px-margin-mobile shadow-header backdrop-blur-xl md:px-margin">
          <div className="flex min-w-0 items-center gap-space-sm">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Mở menu"
              className="rounded-lg p-space-xs text-on-surface-variant hover:bg-surface-container-high lg:hidden"
            >
              <Icon name="menu" />
            </button>
            <nav
              aria-label="Breadcrumb"
              className="flex min-w-0 items-center gap-space-xs text-body-sm"
            >
              <span className="text-on-surface-variant">Quản trị</span>
              {title?.title && (
                <>
                  <Icon name="chevron_right" className="text-base text-outline" />
                  <span className="truncate font-semibold text-on-surface">{title.title}</span>
                </>
              )}
            </nav>
          </div>
          <UserMenu afterLogout="/dang-nhap" />
        </header>

        <main className="space-y-space-lg p-margin-mobile md:p-margin">
          <RateLimitBanner />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
