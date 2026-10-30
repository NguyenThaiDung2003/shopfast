import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { ORDER_STATUS_META, type OrderStatus } from '../../orders/order-status';
import { Icon } from './Icon';

const TONE = {
  neutral: 'bg-surface-container-high text-on-surface-variant',
  primary: 'bg-primary-fixed text-on-primary-fixed-variant',
  /** "Chính hãng". */
  brand: 'bg-primary-container text-on-primary',
  secondary: 'bg-secondary-fixed text-on-secondary-fixed',
  /** "Giảm 25%", flash sale. */
  sale: 'bg-sale text-on-error',
  success: 'bg-tertiary-fixed text-on-tertiary-fixed',
  warning: 'bg-secondary-fixed text-on-secondary-fixed-variant',
  danger: 'bg-error-container text-on-error-container',
} as const;

export type BadgeTone = keyof typeof TONE;

export interface BadgeProps {
  tone?: BadgeTone;
  icon?: string;
  /** Viên thuốc (trạng thái) thay vì góc 4px (nhãn sản phẩm). */
  pill?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  children: ReactNode;
}

export function Badge({
  tone = 'neutral',
  icon,
  pill,
  size = 'sm',
  className,
  children,
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-space-xs whitespace-nowrap font-semibold',
        size === 'sm' ? 'px-2 py-0.5 text-label-sm' : 'px-space-md py-1 text-label-md',
        pill ? 'rounded-full' : 'rounded',
        TONE[tone],
        className,
      )}
    >
      {icon && <Icon name={icon} className={size === 'sm' ? 'text-sm' : 'text-base'} />}
      {children}
    </span>
  );
}

export interface OrderStatusBadgeProps {
  status: OrderStatus;
  size?: 'sm' | 'md';
  /** Ẩn icon khi badge nằm trong câu (modal xác nhận). */
  withIcon?: boolean;
  className?: string;
}

/** Badge trạng thái đơn – màu/nhãn lấy từ ORDER_STATUS_META. */
export function OrderStatusBadge({
  status,
  size = 'md',
  withIcon = true,
  className,
}: OrderStatusBadgeProps) {
  const meta = ORDER_STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-space-xs whitespace-nowrap rounded-full font-semibold',
        size === 'sm' ? 'px-2 py-0.5 text-label-sm' : 'px-space-md py-1 text-label-md',
        meta.className,
        className,
      )}
    >
      {withIcon && <Icon name={meta.icon} className={size === 'sm' ? 'text-sm' : 'text-base'} />}
      {meta.label}
    </span>
  );
}
