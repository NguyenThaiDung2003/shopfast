import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface TabItem<V extends string> {
  value: V;
  label: ReactNode;
  /** Số đếm cạnh nhãn ("Đang xử lý 1"). */
  count?: number;
  disabled?: boolean;
}

export interface TabsProps<V extends string> {
  items: TabItem<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Nhãn cho trình đọc màn hình. */
  label: string;
  className?: string;
}

/** Tab gạch chân có số đếm (màn "Đơn hàng của tôi"). Điều khiển bằng mũi tên trái/phải, Home/End. */
export function Tabs<V extends string>({ items, value, onChange, label, className }: TabsProps<V>) {
  const baseId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    // Chỉ di chuyển giữa các tab không bị disabled, vòng tròn ở hai đầu.
    const enabled = items.flatMap((item, i) => (item.disabled ? [] : [i]));
    const pos = enabled.indexOf(index);
    const target =
      event.key === 'ArrowRight'
        ? enabled[(pos + 1) % enabled.length]
        : event.key === 'ArrowLeft'
          ? enabled[(pos - 1 + enabled.length) % enabled.length]
          : event.key === 'Home'
            ? enabled[0]
            : event.key === 'End'
              ? enabled[enabled.length - 1]
              : undefined;
    const item = target === undefined ? undefined : items[target];
    if (target === undefined || !item) return;
    event.preventDefault();
    refs.current[target]?.focus();
    onChange(item.value);
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn('flex overflow-x-auto border-b border-surface-container-high', className)}
    >
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            id={`${baseId}-${item.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-space-sm whitespace-nowrap border-b-2 px-space-lg py-space-md text-body-lg transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
              'disabled:cursor-not-allowed disabled:opacity-40',
              selected
                ? 'border-primary font-semibold text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface',
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={cn(
                  'min-w-5 rounded-full px-1.5 text-center text-label-sm',
                  selected
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container-high text-on-surface-variant',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
