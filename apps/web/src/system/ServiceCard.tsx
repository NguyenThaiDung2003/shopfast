import type { ReactNode } from 'react';
import { Badge, Card, Icon, type BadgeTone } from '../components/ui';

export interface ServiceMetric {
  label: string;
  value: ReactNode;
}

/** Thẻ một dịch vụ lõi: tên, trạng thái, hai ô số liệu. */
export function ServiceCard({
  name,
  subtitle,
  icon,
  status,
  metrics,
}: {
  name: string;
  subtitle: string;
  icon: string;
  status?: { label: string; tone: BadgeTone; icon: string };
  metrics: ServiceMetric[];
}) {
  return (
    <Card className="space-y-space-md p-space-lg" aria-label={name} role="group">
      <div className="flex items-start gap-space-md">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-primary">
          <Icon name={icon} className="text-2xl" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-title-md text-on-surface">{name}</h3>
          <p className="text-body-sm text-on-surface-variant">{subtitle}</p>
        </div>
        {status && (
          <Badge tone={status.tone} icon={status.icon} pill>
            {status.label}
          </Badge>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-space-sm">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-lg bg-surface-container-low p-space-md">
            <dt className="text-body-sm text-on-surface-variant">{metric.label}</dt>
            <dd className="break-words text-title-md text-on-surface">{metric.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
