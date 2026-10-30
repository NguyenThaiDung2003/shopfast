import { useEffect, useState, useSyncExternalStore } from 'react';
import { rateLimitStore } from '../api/rate-limit';
import { cn } from '../lib/cn';
import { formatCountdown } from '../lib/format';
import { Icon } from './ui';

/**
 * Banner 429 (thiết kế "Đăng nhập và trạng thái cảnh báo"): đếm ngược theo Retry-After,
 * tự ẩn khi hết giờ. `LOGIN_LOCKED` dùng giao diện đỏ "Tài khoản tạm khoá".
 */
export function RateLimitBanner({ className }: { className?: string }) {
  const state = useSyncExternalStore(rateLimitStore.subscribe, rateLimitStore.getSnapshot);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!state) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= state.until) rateLimitStore.clear();
    };
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [state]);

  if (!state) return null;

  const remaining = Math.max(0, Math.ceil((state.until - now) / 1000));
  const progress = Math.min(100, (remaining / state.totalSeconds) * 100);
  const locked = state.code === 'LOGIN_LOCKED';

  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-space-md rounded-lg p-space-lg shadow-card',
        locked ? 'bg-error-container/70' : 'bg-secondary-fixed/40',
        className,
      )}
    >
      <div
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
          locked ? 'bg-error text-on-error' : 'bg-secondary-container text-on-secondary',
        )}
      >
        <Icon name={locked ? 'gpp_bad' : 'history'} className="text-2xl" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-space-sm">
          <p className={cn('text-title-md', locked ? 'text-on-error-container' : 'text-secondary')}>
            {locked ? 'Tài khoản tạm khoá' : 'Cảnh báo giới hạn thao tác'}
          </p>
          <span
            className={cn(
              'inline-flex items-center gap-space-xs rounded-full px-space-md py-0.5 text-label-md tabular-nums',
              locked ? 'bg-error text-on-error' : 'bg-surface-container-lowest text-secondary',
            )}
            aria-live="off"
          >
            <Icon name="lock_clock" className="text-base" />
            Thử lại sau: {formatCountdown(remaining)}
          </span>
        </div>
        <p
          className={cn(
            'mt-space-xs text-body-md',
            locked ? 'text-on-error-container' : 'text-on-secondary-fixed-variant',
          )}
        >
          {state.message}
        </p>
        <div
          className="mt-space-sm h-1.5 overflow-hidden rounded-full bg-surface-container-lowest"
          aria-hidden
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-1000 ease-linear',
              locked ? 'bg-error' : 'bg-secondary-container',
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      <button
        type="button"
        onClick={() => rateLimitStore.clear()}
        aria-label="Ẩn cảnh báo"
        className="text-outline transition-colors hover:text-on-surface"
      >
        <Icon name="close" className="text-lg" />
      </button>
    </div>
  );
}
