import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Hover nâng card (thẻ sản phẩm, thẻ bấm được). */
  interactive?: boolean;
  /** Bỏ padding mặc định (khi dùng CardHeader/CardBody/CardFooter hoặc ảnh tràn viền). */
  flush?: boolean;
}

/** Container mức 1: nền trắng, bo 8px, shadow nhẹ, viền mờ (DESIGN.md → Elevation). */
export function Card({ interactive, flush, className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-outline-variant/40 bg-surface-container-lowest shadow-card',
        !flush && 'p-space-lg',
        interactive && 'transition hover:-translate-y-0.5 hover:shadow-card-hover',
        className,
      )}
      {...rest}
    />
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Icon trong ô vuông bo góc đầu tiêu đề. */
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function CardHeader({ title, subtitle, icon, actions, className }: CardHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-space-md border-b border-surface-container-high px-space-lg py-space-md',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-space-md">
        {icon}
        <div className="min-w-0">
          <h2 className="truncate text-title-md text-on-surface">{title}</h2>
          {subtitle && <p className="text-body-sm text-on-surface-variant">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-space-sm">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-space-lg', className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-space-md border-t border-surface-container-high px-space-lg py-space-md',
        className,
      )}
      {...rest}
    />
  );
}
