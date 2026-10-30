import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { Icon } from './Icon';

const SIZE = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' } as const;

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Icon Material Symbols trong ô vuông đầu tiêu đề (như "Xác nhận chuyển trạng thái"). */
  icon?: string;
  /** Thanh nút cuối hộp thoại. */
  footer?: ReactNode;
  size?: keyof typeof SIZE;
  /** Chặn đóng bằng Esc/bấm ra ngoài (đang gửi request). */
  dismissible?: boolean;
  children?: ReactNode;
}

/** Hộp thoại mức 4 (DESIGN.md): nền scrim, bo 12px, đóng bằng Esc/bấm ngoài, khoá cuộn trang. */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  footer,
  size = 'md',
  dismissible = true,
  children,
}: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open, dismissible]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-scrim p-space-lg backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissible) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-modal focus:outline-none',
          SIZE[size],
        )}
      >
        <div className="flex items-start gap-space-md bg-surface-container-low px-space-xl py-space-lg">
          {icon && (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-secondary-fixed text-secondary-container">
              <Icon name={icon} className="text-2xl" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-headline-sm text-on-surface">
              {title}
            </h2>
            {subtitle && <p className="text-body-sm text-on-surface-variant">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={!dismissible}
            aria-label="Đóng"
            className="rounded-lg p-space-xs text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40"
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="overflow-y-auto px-space-xl py-space-lg text-body-lg text-on-surface">
          {children}
        </div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-space-md border-t border-surface-container-high px-space-xl py-space-lg">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
