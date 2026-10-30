import { useId } from 'react';
import { cn } from '../../lib/cn';
import { Icon } from './Icon';

export interface QuantityInputProps {
  /** Giữ dạng chuỗi để người dùng gõ tự do; nơi dùng tự validate. */
  value: string;
  onChange: (value: string) => void;
  /** Giá trị "chốt": sau khi bấm −/+, Enter hoặc rời ô (giỏ hàng lưu lên server lúc này). */
  onCommit?: (value: string) => void;
  min?: number;
  max: number;
  disabled?: boolean;
  error?: string;
  label?: string;
  /** Cao 40px (dòng giỏ hàng) thay vì 48px. */
  compact?: boolean;
  className?: string;
}

/** Ô số lượng có nút −/+ (chi tiết sản phẩm, giỏ hàng). Nút −/+ luôn kẹp trong [min, max]. */
export function QuantityInput({
  value,
  onChange,
  onCommit,
  min = 1,
  max,
  disabled,
  error,
  label = 'Số lượng',
  compact,
  className,
}: QuantityInputProps) {
  const id = useId();
  const parsed = Number.parseInt(value, 10);
  const current = Number.isNaN(parsed) ? min : parsed;
  const step = (delta: number) => {
    const next = String(Math.min(Math.max(current + delta, min), Math.max(min, max)));
    onChange(next);
    onCommit?.(next);
  };

  const button =
    'flex h-full w-11 items-center justify-center rounded-md text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:text-outline-variant disabled:hover:bg-transparent';

  return (
    <div className={cn('flex flex-col gap-space-xs', className)}>
      <div
        className={cn(
          'inline-flex items-center gap-space-xs rounded-lg border bg-surface-container-lowest p-space-xs',
          compact ? 'h-10' : 'h-12',
          error ? 'border-error' : 'border-outline-variant',
          disabled && 'bg-surface-container-low',
        )}
      >
        <button
          type="button"
          className={button}
          onClick={() => step(-1)}
          disabled={disabled || current <= min}
          aria-label="Giảm số lượng"
        >
          <Icon name="remove" />
        </button>
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onCommit?.(value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit?.(value);
          }}
          inputMode="numeric"
          disabled={disabled}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-full w-12 bg-transparent text-center text-title-md text-on-surface focus:outline-none disabled:text-outline"
        />
        <button
          type="button"
          className={button}
          onClick={() => step(1)}
          disabled={disabled || current >= max}
          aria-label="Tăng số lượng"
        >
          <Icon name="add" />
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} className="text-body-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
