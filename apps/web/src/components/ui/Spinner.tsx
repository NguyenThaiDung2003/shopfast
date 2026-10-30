import { cn } from '../../lib/cn';

const SIZE = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-10 w-10 border-[3px]',
} as const;

export interface SpinnerProps {
  size?: keyof typeof SIZE;
  className?: string;
  label?: string;
}

export function Spinner({ size = 'md', className, label = 'Đang tải' }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        'inline-block shrink-0 animate-spin rounded-full border-current border-r-transparent',
        SIZE[size],
        className,
      )}
    />
  );
}

/** Spinner căn giữa một vùng (đang tải trang/khối). */
export function LoadingBlock({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-space-sm py-16 text-primary">
      <Spinner size="lg" label={label} />
      <span className="text-body-sm text-on-surface-variant">{label}</span>
    </div>
  );
}
