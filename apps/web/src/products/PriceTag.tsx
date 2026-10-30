import { Badge } from '../components/ui';
import { cn } from '../lib/cn';
import { formatPrice } from '../lib/format';
import type { Product } from './product-api';
import { discountPercent, formatSold } from './product-display';

/** Giá bán, giá gốc gạch ngang, % giảm và số đã bán (chỉ hiện khi có dữ liệu). */
export function PriceTag({
  product,
  className,
}: {
  product: Pick<Product, 'price' | 'compareAtPrice' | 'soldCount'>;
  className?: string;
}) {
  const discount = discountPercent(product.price, product.compareAtPrice);
  return (
    <div className="space-y-space-xs">
      <div className="flex flex-wrap items-baseline gap-x-space-sm gap-y-space-xs">
        <span className={cn('text-secondary-container', className)}>
          {formatPrice(product.price)}
        </span>
        {discount !== null && (
          <>
            <del className="text-body-sm text-outline">{formatPrice(product.compareAtPrice!)}</del>
            <Badge tone="sale">-{discount}%</Badge>
          </>
        )}
      </div>
      {Boolean(product.soldCount) && (
        <p className="text-body-sm text-on-surface-variant">{formatSold(product.soldCount!)}</p>
      )}
    </div>
  );
}
