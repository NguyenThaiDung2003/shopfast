import { cn } from '../../lib/cn';

export function describedBy(id: string, error: unknown, hint: unknown): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

/** `multiline`: textarea – không cố định chiều cao. */
export const controlClass = (invalid: boolean, multiline = false) =>
  cn(
    !multiline && 'h-11 md:h-10',
    'w-full rounded border bg-surface-container-lowest text-body-md text-on-surface',
    'placeholder:text-outline transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary/30',
    'disabled:cursor-not-allowed disabled:bg-surface-container-low disabled:text-on-surface-variant',
    invalid
      ? 'border-error focus:border-error focus:ring-error/20'
      : 'border-outline-variant hover:border-outline focus:border-primary',
  );
