import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/cn';
import { Icon } from './ui';

export interface BreadcrumbItem {
  label: string;
  /** Bỏ trống ở mục cuối (trang hiện tại). */
  to?: string;
}

/** "Trang chủ › … › Trang hiện tại"; luôn bắt đầu bằng Trang chủ. */
export function Breadcrumb({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn('text-body-md', className)}>
      <ol className="flex flex-wrap items-center gap-space-xs">
        <li>
          <Link
            to="/"
            className="flex items-center gap-space-xs text-on-surface-variant hover:text-primary"
          >
            <Icon name="home" className="text-lg" />
            Trang chủ
          </Link>
        </li>
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <Fragment key={`${item.label}-${index}`}>
              <li aria-hidden>
                <Icon name="chevron_right" className="text-base text-outline" />
              </li>
              <li className="min-w-0">
                {item.to && !last ? (
                  <Link to={item.to} className="text-on-surface-variant hover:text-primary">
                    {item.label}
                  </Link>
                ) : (
                  <span
                    className="line-clamp-1 font-semibold text-on-surface"
                    aria-current={last ? 'page' : undefined}
                  >
                    {item.label}
                  </span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
