import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Icon } from './Icon';

export interface EmptyStateProps {
  icon?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Nút hành động (ví dụ "Tiếp tục mua sắm"). */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-space-lg py-12 text-center',
        className,
      )}
    >
      <div className="mb-space-lg flex h-16 w-16 items-center justify-center rounded-full bg-surface-container text-primary">
        <Icon name={icon} className="text-3xl" />
      </div>
      <h3 className="text-headline-sm text-on-surface">{title}</h3>
      {description && (
        <p className="mt-space-xs max-w-md text-body-md text-on-surface-variant">{description}</p>
      )}
      {action && (
        <div className="mt-space-xl flex flex-wrap justify-center gap-space-sm">{action}</div>
      )}
    </div>
  );
}
