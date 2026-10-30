import { cn } from '../lib/cn';
import { Icon } from './ui';

const STEPS = [
  { label: 'Giỏ hàng', icon: 'shopping_cart' },
  { label: 'Thanh toán', icon: 'credit_card' },
  { label: 'Hoàn tất', icon: 'verified' },
] as const;

/** Stepper 3 bước của luồng đặt hàng; `current` từ 1. Bước 3 đã xong thì mọi bước đều xanh. */
export function CheckoutSteps({ current, done }: { current: 1 | 2 | 3; done?: boolean }) {
  return (
    <ol aria-label="Các bước đặt hàng" className="mx-auto flex max-w-2xl items-start">
      {STEPS.map((step, index) => {
        const number = index + 1;
        const passed = number < current || Boolean(done);
        const active = number === current && !done;
        return (
          <li
            key={step.label}
            aria-current={active ? 'step' : undefined}
            className="relative flex flex-1 flex-col items-center gap-space-xs text-center"
          >
            {index > 0 && (
              <span
                aria-hidden
                className={cn(
                  'absolute right-1/2 top-5 h-1 w-full -translate-y-1/2',
                  number <= current ? 'bg-primary-container' : 'bg-surface-container-high',
                )}
              />
            )}
            <span
              className={cn(
                'relative z-10 flex h-10 w-10 items-center justify-center rounded-lg',
                passed && 'bg-primary-container text-on-primary',
                active && 'bg-secondary-container text-on-secondary ring-4 ring-secondary-fixed',
                !passed && !active && 'bg-surface-container-high text-outline',
              )}
            >
              <Icon name={passed ? 'check' : step.icon} className="text-xl" />
            </span>
            <span
              className={cn(
                'text-title-sm',
                active ? 'text-secondary' : passed ? 'text-primary' : 'text-outline',
              )}
            >
              {number}. {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
