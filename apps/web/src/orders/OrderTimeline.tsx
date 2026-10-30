import { Badge, Icon } from '../components/ui';
import { cn } from '../lib/cn';
import { formatDateTime } from '../lib/format';
import type { TimelineStep } from './order-tracking';

const MARKER: Record<TimelineStep['state'], { icon: string; className: string }> = {
  done: { icon: 'check', className: 'bg-primary-container text-on-primary' },
  current: {
    icon: 'local_shipping',
    className: 'bg-secondary-container text-on-secondary ring-4 ring-secondary-fixed',
  },
  upcoming: { icon: 'schedule', className: 'bg-surface-container-high text-outline' },
  cancelled: { icon: 'close', className: 'bg-error text-on-error ring-4 ring-error-container' },
};

/** "Chi tiết lịch trình vận chuyển": các chặng đã qua, chặng hiện tại (nổi bật), chặng sắp tới. */
export function OrderTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="relative space-y-space-lg" aria-label="Lịch trình đơn hàng">
      {steps.map((step, index) => {
        const marker = MARKER[step.state];
        const highlighted = step.state === 'current' || step.state === 'cancelled';
        return (
          <li
            key={step.status}
            className="relative flex gap-space-md"
            aria-current={highlighted ? 'step' : undefined}
            data-state={step.state}
          >
            {index < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  'absolute left-4 top-9 -bottom-space-lg w-0.5 -translate-x-1/2',
                  step.state === 'done' ? 'bg-primary-container' : 'bg-surface-container-high',
                )}
              />
            )}
            <span
              aria-hidden
              className={cn(
                'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                marker.className,
              )}
            >
              <Icon name={marker.icon} className="text-lg" />
            </span>
            <div
              className={cn(
                'min-w-0 flex-1',
                highlighted &&
                  (step.state === 'cancelled'
                    ? 'rounded-lg bg-error-container/40 p-space-md'
                    : 'rounded-lg bg-surface-container-low p-space-md'),
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-space-md gap-y-space-xs">
                <h3
                  className={cn(
                    'flex items-center gap-space-sm',
                    highlighted ? 'text-headline-sm' : 'text-title-md',
                    step.state === 'upcoming' && 'text-outline',
                    step.state === 'current' && 'text-primary',
                    step.state === 'cancelled' && 'text-error',
                    step.state === 'done' && 'text-on-surface',
                  )}
                >
                  {step.title}
                  {step.state === 'current' && (
                    <Badge tone="sale" pill>
                      Hiện tại
                    </Badge>
                  )}
                </h3>
                <span
                  className={cn(
                    'text-body-sm',
                    highlighted ? 'font-semibold text-primary' : 'text-on-surface-variant',
                  )}
                >
                  {step.at
                    ? formatDateTime(step.at)
                    : step.state === 'upcoming'
                      ? 'Chưa tới'
                      : 'Vừa cập nhật'}
                </span>
              </div>
              <p
                className={cn(
                  'mt-space-xs text-body-md',
                  step.state === 'upcoming' ? 'text-outline' : 'text-on-surface-variant',
                )}
              >
                {step.description}
              </p>
              {step.note && (
                <p className="mt-space-sm inline-flex items-center gap-space-xs rounded bg-surface-container-lowest px-space-sm py-space-xs text-body-sm text-primary">
                  <Icon name="sticky_note_2" className="text-base" />
                  {step.note}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
