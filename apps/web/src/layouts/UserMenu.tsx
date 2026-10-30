import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROLE_LABEL } from '../auth/roles';
import { useLogout, useMe, useSession } from '../auth/useAuth';
import { cn } from '../lib/cn';
import { Icon } from '../components/ui';

function initials(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts.at(-1)?.[0] ?? '?').toUpperCase();
}

export interface UserMenuProps {
  /** Đi đâu sau khi đăng xuất. */
  afterLogout: string;
  /** Ẩn họ tên trên màn nhỏ. */
  compact?: boolean;
}

/** Avatar chữ cái + họ tên + vai trò, menu thả xuống có "Đăng xuất". */
export function UserMenu({ afterLogout, compact }: UserMenuProps) {
  const session = useSession();
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!session) return null;

  const onLogout = () => {
    setOpen(false);
    logout.mutate(undefined, { onSettled: () => navigate(afterLogout, { replace: true }) });
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-space-sm rounded-xl p-space-xs text-left transition-colors hover:bg-surface-container-high"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-container text-title-sm text-on-primary">
          {initials(me?.fullName)}
        </span>
        <span className={cn('flex-col', compact ? 'hidden' : 'hidden md:flex')}>
          <span className="max-w-[10rem] truncate text-title-sm text-on-surface">
            {me?.fullName ?? 'Tài khoản'}
          </span>
          <span className="text-label-sm text-secondary">{ROLE_LABEL[session.user.role]}</span>
        </span>
        <Icon name="expand_more" className="text-lg text-outline" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-space-xs w-60 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest py-space-xs shadow-float"
        >
          {me && (
            <div className="border-b border-surface-container-high px-space-lg py-space-sm">
              <p className="truncate text-title-sm text-on-surface">{me.fullName}</p>
              <p className="truncate text-body-sm text-on-surface-variant">{me.email}</p>
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={onLogout}
            className="flex w-full items-center gap-space-sm px-space-lg py-space-sm text-body-md text-error transition-colors hover:bg-error-container/50"
          >
            <Icon name="logout" className="text-lg" />
            Đăng xuất
          </button>
        </div>
      )}
    </div>
  );
}
