import { formatNumber } from '../../lib/format';
import { cn } from '../../lib/cn';
import { Icon } from './Icon';

export interface PaginationProps {
  /** Trang hiện tại, bắt đầu từ 1. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Danh từ trong "Hiển thị 1 - 10 trong số 1.248 đơn hàng". */
  itemLabel?: string;
  className?: string;
}

type PageItem = number | 'gap-left' | 'gap-right';

/** 1 … 4 5 6 … 20 – luôn giữ trang đầu/cuối và hai bên trang hiện tại. */
function pageItems(page: number, totalPages: number): PageItem[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  const items: PageItem[] = [1];
  if (start > 2) items.push('gap-left');
  for (let p = start; p <= end; p++) items.push(p);
  if (end < totalPages - 1) items.push('gap-right');
  items.push(totalPages);
  return items;
}

const navButton =
  'flex h-9 min-w-9 items-center justify-center rounded-lg px-space-sm text-title-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  itemLabel = 'mục',
  className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <nav
      aria-label="Phân trang"
      className={cn('flex flex-wrap items-center justify-between gap-space-md', className)}
    >
      <p className="text-body-md text-on-surface-variant">
        Hiển thị{' '}
        <strong className="font-semibold text-on-surface">
          {formatNumber(from)} - {formatNumber(to)}
        </strong>{' '}
        trong số <strong className="font-semibold text-on-surface">{formatNumber(total)}</strong>{' '}
        {itemLabel}
      </p>
      {totalPages > 1 && (
        <ul className="flex items-center gap-space-xs">
          <li>
            <button
              type="button"
              className={cn(
                navButton,
                'text-on-surface-variant hover:bg-surface-container-high disabled:opacity-40',
              )}
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              aria-label="Trang trước"
            >
              <Icon name="chevron_left" />
            </button>
          </li>
          {pageItems(page, totalPages).map((item) =>
            typeof item === 'number' ? (
              <li key={item}>
                <button
                  type="button"
                  onClick={() => onPageChange(item)}
                  aria-current={item === page ? 'page' : undefined}
                  className={cn(
                    navButton,
                    item === page
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-on-surface hover:bg-surface-container-high',
                  )}
                >
                  {item}
                </button>
              </li>
            ) : (
              <li key={item} className="px-space-xs text-on-surface-variant" aria-hidden>
                …
              </li>
            ),
          )}
          <li>
            <button
              type="button"
              className={cn(
                navButton,
                'text-on-surface-variant hover:bg-surface-container-high disabled:opacity-40',
              )}
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              aria-label="Trang sau"
            >
              <Icon name="chevron_right" />
            </button>
          </li>
        </ul>
      )}
    </nav>
  );
}
