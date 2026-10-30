import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorMessage, isApiError } from '../api/errors';
import { Breadcrumb } from '../components/Breadcrumb';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  QuantityInput,
  Tabs,
  useToast,
} from '../components/ui';
import { cn } from '../lib/cn';
import { formatDateTime, formatNumber } from '../lib/format';
import {
  fetchProduct,
  parseProductId,
  productKeys,
  type ProductDetail,
} from '../products/product-api';
import { PriceTag } from '../products/PriceTag';
import { stockStatus } from '../products/product-display';
import { ProductImage } from '../products/ProductImage';
import { maxPurchasable, validateQuantity } from '../products/quantity';
import { useAddToCart } from '../products/useAddToCart';

type DetailTab = 'description' | 'specs';

const DOT: Record<string, string> = {
  success: 'bg-tertiary-container',
  warning: 'bg-secondary-container',
  neutral: 'bg-outline',
};

function NotFound() {
  return (
    <Card>
      <EmptyState
        icon="search_off"
        title="Không tìm thấy sản phẩm"
        description="Sản phẩm không tồn tại hoặc đã ngừng kinh doanh."
        action={
          <Link
            to="/san-pham"
            className="inline-flex h-10 items-center gap-space-sm rounded-lg bg-primary-container px-space-lg text-title-sm text-on-primary transition-colors hover:bg-primary"
          >
            <Icon name="storefront" className="text-lg" />
            Xem sản phẩm khác
          </Link>
        }
      />
    </Card>
  );
}

function DetailSkeleton() {
  const bar = 'rounded bg-surface-container-high';
  return (
    <div
      role="status"
      aria-label="Đang tải sản phẩm"
      className="grid animate-pulse gap-space-xl lg:grid-cols-12"
    >
      <Card className="aspect-square lg:col-span-5">
        <div className="h-full w-full rounded-lg bg-surface-container-low" />
      </Card>
      <Card className="space-y-space-lg p-space-xl lg:col-span-7">
        <div className={cn(bar, 'h-6 w-40')} />
        <div className={cn(bar, 'h-9 w-full')} />
        <div className={cn(bar, 'h-9 w-2/3')} />
        <div className={cn(bar, 'h-28 w-full rounded-lg')} />
        <div className={cn(bar, 'h-12 w-full rounded-lg')} />
      </Card>
    </div>
  );
}

/** Trang "Chi tiết sản phẩm" (thiết kế apps/web/design/chi-tiet-san-pham). */
export function ProductDetailPage() {
  const { id: rawId } = useParams();
  const id = parseProductId(rawId);
  const query = useQuery({
    queryKey: productKeys.detail(id ?? 0),
    queryFn: ({ signal }) => fetchProduct(id as number, signal),
    enabled: id !== null,
  });

  const name = query.data?.name;
  useEffect(() => {
    if (!name) return;
    document.title = `${name} | ShopFast`;
    return () => {
      document.title = 'ShopFast';
    };
  }, [name]);

  if (id === null || (isApiError(query.error) && query.error.status === 404)) {
    return <NotFound />;
  }
  if (query.isPending) return <DetailSkeleton />;
  if (query.isError) {
    return (
      <Card>
        <EmptyState
          icon="cloud_off"
          title="Không tải được thông tin sản phẩm"
          description={errorMessage(query.error)}
          action={
            <Button
              variant="brand"
              icon="refresh"
              loading={query.isFetching}
              onClick={() => void query.refetch()}
            >
              Thử lại
            </Button>
          }
        />
      </Card>
    );
  }
  return <ProductDetailView product={query.data} />;
}

function ProductDetailView({ product }: { product: ProductDetail }) {
  const navigate = useNavigate();
  const toast = useToast();
  const cart = useAddToCart();
  const [quantityText, setQuantityText] = useState('1');
  const [action, setAction] = useState<'add' | 'buy' | null>(null);
  const [tab, setTab] = useState<DetailTab>('description');

  const stock = stockStatus(product.stock);
  const maxQuantity = maxPurchasable(product.stock);
  const quantityError = stock.inStock ? validateQuantity(quantityText, product.stock) : undefined;
  const canSubmit = stock.inStock && !quantityError && !cart.isPending;

  const submit = (kind: 'add' | 'buy') => {
    if (!canSubmit) return;
    setAction(kind);
    const quantity = Number(quantityText.trim());
    cart.add(product, quantity, kind === 'buy' ? () => navigate('/gio-hang') : undefined);
  };

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: product.name, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success('Đã sao chép liên kết sản phẩm');
      }
    } catch (error) {
      // Người dùng đóng hộp chia sẻ → không báo lỗi.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      toast.error('Không chia sẻ được', 'Hãy sao chép đường dẫn trên thanh địa chỉ.');
    }
  };

  const categoryLink = `/san-pham?categoryId=${product.category.id}`;
  const brandLink = `/san-pham?brandId=${product.brand.id}`;

  return (
    <div className="space-y-space-xl">
      <Breadcrumb
        items={[
          { label: 'Sản phẩm', to: '/san-pham' },
          { label: product.category.name, to: categoryLink },
          { label: product.name },
        ]}
      />

      <div className="grid items-start gap-space-xl lg:grid-cols-12">
        <Card className="relative p-space-lg lg:col-span-5">
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-surface-container-low">
            <ProductImage
              src={product.imageUrl}
              name={product.name}
              categorySlug={product.category.slug}
              dimmed={!stock.inStock}
              iconClassName="text-[160px]"
            />
          </div>
          {!stock.inStock && (
            <Badge tone="neutral" size="md" className="absolute left-space-xl top-space-xl">
              Hết hàng
            </Badge>
          )}
        </Card>

        <Card className="space-y-space-lg p-space-lg md:p-space-xl lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-space-sm">
            <Link to={brandLink} aria-label={`Xem sản phẩm ${product.brand.name}`}>
              <Badge tone="brand" icon="verified" size="md">
                {product.brand.name}
              </Badge>
            </Link>
            <Button variant="ghost" size="sm" icon="share" onClick={() => void share()}>
              Chia sẻ
            </Button>
          </div>

          <div className="space-y-space-sm">
            <h1 className="text-headline-lg-mobile text-on-surface md:text-headline-lg">
              {product.name}
            </h1>
            <p className="flex flex-wrap items-center gap-x-space-sm text-body-md text-on-surface-variant">
              <span>
                SKU: <strong className="font-semibold text-on-surface">{product.sku}</strong>
              </span>
              <span aria-hidden>•</span>
              <span>
                Danh mục:{' '}
                <Link to={categoryLink} className="font-semibold text-primary hover:underline">
                  {product.category.name}
                </Link>
              </span>
            </p>
          </div>

          <div className="rounded-lg bg-surface-container-low p-space-lg">
            <PriceTag product={product} className="text-display-hero-mobile md:text-display-hero" />
            <p className="mt-space-xs text-body-sm text-on-surface-variant">
              Giá đã gồm VAT. Giá chốt khi đặt hàng.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-space-sm rounded-lg bg-surface-container-low px-space-lg py-space-md">
            <span className="flex items-center gap-space-sm text-title-sm text-on-surface">
              <span className={cn('h-2.5 w-2.5 rounded-full', DOT[stock.tone])} aria-hidden />
              {stock.inStock
                ? stock.tone === 'warning'
                  ? 'Sắp hết hàng'
                  : 'Còn hàng'
                : stock.label}
            </span>
            <span className="rounded bg-surface-container-lowest px-space-sm py-0.5 text-body-sm text-on-surface-variant">
              {stock.inStock
                ? `Còn ${formatNumber(product.stock)} sản phẩm`
                : '0 sản phẩm khả dụng'}
            </span>
          </div>

          {cart.purchase === 'staff' ? (
            <p className="flex items-center gap-space-sm rounded-lg bg-primary-fixed/50 px-space-lg py-space-md text-body-md text-on-primary-fixed-variant">
              <Icon name="badge" />
              Tài khoản nhân viên chỉ xem thông tin sản phẩm.
            </p>
          ) : (
            <div className="flex flex-col gap-space-md sm:flex-row sm:items-start">
              <QuantityInput
                value={stock.inStock ? quantityText : '0'}
                onChange={setQuantityText}
                max={maxQuantity}
                disabled={!stock.inStock}
                error={quantityError}
              />
              <Button
                size="lg"
                icon={stock.inStock ? 'add_shopping_cart' : 'remove_shopping_cart'}
                className="h-12 flex-1"
                disabled={!canSubmit}
                loading={cart.isPending && action === 'add'}
                onClick={() => submit('add')}
              >
                {stock.inStock ? 'Thêm vào giỏ hàng' : 'Tạm hết hàng'}
              </Button>
              <Button
                size="lg"
                variant="brand"
                icon="bolt"
                className="h-12 flex-1"
                disabled={!canSubmit}
                loading={cart.isPending && action === 'buy'}
                onClick={() => submit('buy')}
              >
                Mua ngay
              </Button>
            </div>
          )}
        </Card>
      </div>

      <Card className="p-space-lg md:p-space-xl">
        <Tabs<DetailTab>
          label="Thông tin sản phẩm"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'description', label: 'Mô tả sản phẩm' },
            { value: 'specs', label: 'Thông số kỹ thuật' },
          ]}
        />
        <div role="tabpanel" className="pt-space-xl">
          {tab === 'description' ? (
            product.description?.trim() ? (
              <div className="max-w-3xl whitespace-pre-line text-body-lg text-on-surface">
                {product.description}
              </div>
            ) : (
              <EmptyState icon="description" title="Chưa có mô tả cho sản phẩm này" />
            )
          ) : (
            <dl className="max-w-2xl divide-y divide-surface-container-high text-body-md">
              {[
                ['Mã SKU', product.sku],
                ['Thương hiệu', product.brand.name],
                ['Danh mục', product.category.name],
                [
                  'Tình trạng kho',
                  stock.inStock
                    ? `${stock.label} – ${formatNumber(product.stock)} sản phẩm`
                    : stock.label,
                ],
                ['Cập nhật lúc', formatDateTime(product.updatedAt)],
              ].map(([term, value]) => (
                <div key={term} className="grid grid-cols-3 gap-space-md py-space-md">
                  <dt className="text-on-surface-variant">{term}</dt>
                  <dd className="col-span-2 font-semibold text-on-surface">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </Card>
    </div>
  );
}
