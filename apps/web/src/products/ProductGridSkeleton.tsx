import { Card } from '../components/ui';
import { cn } from '../lib/cn';
import type { ProductView } from './product-filters';

const bar = 'rounded bg-surface-container-high';

/** Khung chờ cùng bố cục với lưới sản phẩm (không nhảy layout khi dữ liệu về). */
export function ProductGridSkeleton({ count = 8, view }: { count?: number; view: ProductView }) {
  return (
    <div
      role="status"
      aria-label="Đang tải sản phẩm"
      className={cn(
        'animate-pulse',
        view === 'grid'
          ? 'grid grid-cols-2 gap-gutter-mobile md:grid-cols-3 md:gap-gutter xl:grid-cols-4'
          : 'space-y-space-md',
      )}
    >
      {Array.from({ length: count }, (_, i) => (
        <Card
          key={i}
          flush
          className={cn('p-space-sm', view === 'list' && 'flex items-center gap-space-md')}
        >
          <div
            className={cn(
              'aspect-square rounded-lg bg-surface-container-low',
              view === 'list' ? 'w-24 sm:w-36' : 'w-full',
            )}
          />
          <div className="flex-1 space-y-space-sm px-space-xs pt-space-md">
            <div className={cn(bar, 'h-3 w-1/3')} />
            <div className={cn(bar, 'h-4 w-full')} />
            <div className={cn(bar, 'h-4 w-2/3')} />
            <div className={cn(bar, 'h-6 w-1/2')} />
            <div className={cn(bar, 'h-10 w-full rounded-lg')} />
          </div>
        </Card>
      ))}
    </div>
  );
}
