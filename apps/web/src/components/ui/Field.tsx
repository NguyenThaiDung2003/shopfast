import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface FieldProps {
  id: string;
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/** Khung nhãn + gợi ý + lỗi dùng chung cho Input/Select. */
export function Field({ id, label, hint, error, required, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-space-xs', className)}>
      {label && (
        <label htmlFor={id} className="text-label-md text-on-surface">
          {label}
          {required && (
            <span className="ml-0.5 text-error" aria-hidden>
              *
            </span>
          )}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-body-sm text-error">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-body-sm text-on-surface-variant">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
