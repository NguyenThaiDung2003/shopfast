import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

const VARIANT = {
  /** CTA chuyển đổi: "Mua ngay", "Thêm vào giỏ", "Xác nhận" – cam. */
  primary:
    'bg-secondary-container text-on-secondary shadow-sm hover:bg-secondary active:bg-on-secondary-fixed-variant',
  /** Phương án phụ cho CTA: viền cam, nền nhạt. */
  secondary:
    'border border-secondary-container bg-secondary-fixed/40 text-secondary hover:bg-secondary-fixed',
  /** Điều hướng/tài khoản: xanh đậm. */
  brand: 'bg-primary-container text-on-primary hover:bg-primary',
  /** "Xem chi tiết": nền xanh nhạt. */
  tonal: 'bg-primary-fixed text-primary hover:bg-primary-fixed-dim',
  /** Nút trung tính: "Huỷ bỏ". */
  outline:
    'border border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container-low',
  ghost: 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
  danger: 'bg-error text-on-error hover:bg-on-error-container',
} as const;

const SIZE = {
  sm: 'h-8 px-space-md text-label-md gap-space-xs',
  // 44px trên mobile (vùng chạm), 40px từ md.
  md: 'h-11 md:h-10 px-space-lg text-title-sm gap-space-sm',
  lg: 'h-12 px-space-xl text-title-md gap-space-sm',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANT;
  size?: keyof typeof SIZE;
  loading?: boolean;
  /** Icon Material Symbols đứng trước nhãn. */
  icon?: string;
  iconRight?: string;
  fullWidth?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    iconRight,
    fullWidth,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap rounded-lg font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Spinner size="sm" label="Đang xử lý" />
      ) : (
        icon && <Icon name={icon} className="text-lg" />
      )}
      {children}
      {iconRight && !loading && <Icon name={iconRight} className="text-lg" />}
    </button>
  );
});
