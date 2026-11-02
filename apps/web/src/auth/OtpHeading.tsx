import type { ReactNode } from 'react';
import { Icon } from '../components/ui';

export function OtpHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-space-sm text-center">
      <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-xl bg-primary-fixed text-primary">
        <Icon name="verified_user" className="text-4xl" />
      </span>
      <h1 className="text-headline-lg-mobile text-on-surface md:text-headline-lg">{title}</h1>
      <div className="text-body-md text-on-surface-variant">{children}</div>
    </div>
  );
}
