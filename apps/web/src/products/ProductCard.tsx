import { Link } from 'react-router-dom';
import { Badge, Button, Card } from '../components/ui';
import { cn } from '../lib/cn';
import type { Product } from './product-api';
import { stockStatus } from './product-display';
import { PriceTag } from './PriceTag';
import { ProductImage } from './ProductImage';
import type { ProductView } from './product-filters';
import type { PurchaseMode } from './useAddToCart';

export interface ProductCardProps {
  product: Product;
  view: ProductView;
  purchase: PurchaseMode;
  adding: boolean;
  onAddToCart: (product: Product) => void;
}

function CardImage({ product, className }: { product: Product; className?: string }) {
  const stock = stockStatus(product.stock);
  return (
    <Link
      to={`/san-pham/${product.id}`}
      tabIndex={-1}
      aria-hidden
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-container-low',
        className,
      )}
    >
      <ProductImage
        src={product.imageUrl}
        name={product.name}
        categorySlug={product.category.slug}
        dimmed={!stock.inStock}
        iconClassName="text-[64px] transition-transform duration-300 group-hover:scale-105"
      />
      {!stock.inStock && (
        <Badge tone="neutral" className="absolute left-space-sm top-space-sm">
          Hết hàng
        </Badge>
      )}
    </Link>
  );
}

function StockBadge({ stock }: { stock: number }) {
  const status = stockStatus(stock);
  return (
    <Badge tone={status.tone} pill>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {status.label}
    </Badge>
  );
}

function CartAction({ product, purchase, adding, onAddToCart }: Omit<ProductCardProps, 'view'>) {
  if (purchase === 'staff') return null;
  if (product.stock <= 0) {
    return (
      <Button variant="tonal" icon="notifications_off" fullWidth disabled>
        Tạm hết hàng
      </Button>
    );
  }
  return (
    <Button
      icon="add_shopping_cart"
      fullWidth
      loading={adding}
      onClick={() => onAddToCart(product)}
      aria-label={`Thêm ${product.name} vào giỏ`}
    >
      Thêm vào giỏ
    </Button>
  );
}

/** Thẻ sản phẩm (thiết kế "Danh sách sản phẩm"): dạng lưới hoặc dạng dòng. */
export function ProductCard(props: ProductCardProps) {
  const { product, view } = props;
  const title = (
    <h3 className="line-clamp-2 text-title-md text-on-surface">
      <Link to={`/san-pham/${product.id}`} className="hover:text-primary">
        {product.name}
      </Link>
    </h3>
  );
  const meta = (
    <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">
      {product.brand.name}
    </p>
  );

  if (view === 'list') {
    return (
      <Card
        flush
        interactive
        className="group flex gap-space-md p-space-sm sm:items-center"
        data-testid="product-card"
      >
        <CardImage product={product} className="aspect-square w-24 sm:w-36" />
        <div className="flex min-w-0 flex-1 flex-col gap-space-xs sm:flex-row sm:items-center sm:gap-space-lg">
          <div className="min-w-0 flex-1 space-y-space-xs">
            {meta}
            {title}
            <p className="text-body-sm text-outline">
              {product.category.name} · {product.sku}
            </p>
          </div>
          <div className="flex flex-col gap-space-sm sm:w-48 sm:items-end">
            <PriceTag product={product} className="text-price-md" />
            <StockBadge stock={product.stock} />
            <div className="w-full">
              <CartAction {...props} />
            </div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card flush interactive className="group flex flex-col p-space-sm" data-testid="product-card">
      <CardImage product={product} className="aspect-square w-full" />
      <div className="flex flex-1 flex-col gap-space-xs px-space-xs pb-space-xs pt-space-md">
        {meta}
        {title}
        <p className="text-body-sm text-outline">{product.category.name}</p>
        <div className="mt-auto space-y-space-sm pt-space-sm">
          <PriceTag product={product} className="text-price-md md:text-price-lg" />
          <StockBadge stock={product.stock} />
          <CartAction {...props} />
        </div>
      </div>
    </Card>
  );
}
