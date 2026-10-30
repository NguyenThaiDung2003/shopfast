import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Icon } from './Icon';
import { ToastContext, type ToastApi, type ToastInput, type ToastTone } from './toast-context';

const TONE: Record<ToastTone, { icon: string; box: string; title: string }> = {
  success: {
    icon: 'check_circle',
    box: 'bg-tertiary-fixed text-tertiary-container',
    title: 'text-tertiary-container',
  },
  error: { icon: 'error', box: 'bg-error-container text-error', title: 'text-error' },
  warning: {
    icon: 'warning',
    box: 'bg-secondary-fixed text-secondary',
    title: 'text-secondary',
  },
  info: { icon: 'info', box: 'bg-primary-fixed text-primary', title: 'text-on-surface' },
};

interface ToastItem extends ToastInput {
  id: number;
}

const MAX_TOASTS = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (input: ToastInput) => {
      const id = ++nextId.current;
      setToasts((list) => [...list.slice(-(MAX_TOASTS - 1)), { ...input, id }]);
      window.setTimeout(() => dismiss(id), input.duration ?? 5_000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, description) => show({ tone: 'success', title, description }),
      error: (title, description) => show({ tone: 'error', title, description }),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-space-lg top-space-lg z-[110] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-space-sm"
      >
        {toasts.map((toast) => {
          const tone = TONE[toast.tone ?? 'info'];
          return (
            <div
              key={toast.id}
              role={toast.tone === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex animate-toast-in items-start gap-space-md rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-space-md shadow-float"
            >
              <div
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                  tone.box,
                )}
              >
                <Icon name={tone.icon} filled />
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn('text-title-sm', tone.title)}>{toast.title}</p>
                {toast.description && (
                  <p className="whitespace-pre-line text-body-sm text-on-surface-variant">
                    {toast.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Đóng thông báo"
                className="text-outline transition-colors hover:text-on-surface"
              >
                <Icon name="close" className="text-lg" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
