import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api/errors';
import { Button, Card, EmptyState, Icon, Tabs } from '../components/ui';
import { cn } from '../lib/cn';
import { formatNumber } from '../lib/format';
import {
  BEST_PRICE_LIMIT,
  categoryLink,
  DEFAULT_HOME_TAB,
  fetchHomeProducts,
  HOME_TABS,
  homeKeys,
  parseHomeTab,
  SUGGESTION_LIMIT,
  topCategories,
  type HomeTab,
} from '../products/home-products';
import { fetchCategories, productKeys, type ProductPage } from '../products/product-api';
import { categoryIcon } from '../products/product-display';
import { ProductCard } from '../products/ProductCard';
import { ProductGridSkeleton } from '../products/ProductGridSkeleton';
import { useAddToCart } from '../products/useAddToCart';

const BENEFITS = [
  { icon: 'payments', title: 'Thanh toán khi nhận', text: 'Trả tiền mặt khi nhận hàng' },
  { icon: 'local_shipping', title: 'Miễn phí vận chuyển', text: 'Áp dụng cho mọi đơn hàng' },
  { icon: 'track_changes', title: 'Theo dõi trực tiếp', text: 'Cập nhật trạng thái đơn tức thì' },
  { icon: 'support_agent', title: 'Hỗ trợ trực tuyến', text: 'Gửi yêu cầu ngay trên website' },
];

function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="flex items-center gap-space-sm text-headline-sm text-on-surface md:text-headline-md">
      <span aria-hidden className="h-6 w-1.5 rounded-full bg-primary-container" />
      {children}
    </h2>
  );
}

function RetryState({ title, query }: { title: string; query: UseQueryResult<unknown> }) {
  return (
    <Card flush>
      <EmptyState
        icon="cloud_off"
        title={title}
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

function ProductGrid({
  query,
  skeleton,
  errorTitle,
}: {
  query: UseQueryResult<ProductPage>;
  skeleton: number;
  errorTitle: string;
}) {
  const cart = useAddToCart();
  if (query.isPending) return <ProductGridSkeleton count={skeleton} view="grid" />;
  if (query.isError) return <RetryState title={errorTitle} query={query} />;
  if (query.data.items.length === 0) {
    return (
      <Card flush>
        <EmptyState icon="inventory_2" title="Chưa có sản phẩm nào" />
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-gutter-mobile md:gap-gutter xl:grid-cols-4">
      {query.data.items.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          view="grid"
          purchase={cart.purchase}
          adding={cart.pendingProductId === product.id}
          onAddToCart={(item) => cart.add(item)}
        />
      ))}
    </div>
  );
}

/** Trang chủ (thiết kế apps/web/design/trang-chu-shopfast). */
export function HomePage() {
  const [params, setParams] = useSearchParams();
  const tab = parseHomeTab(params.get('tab'));

  const categories = useQuery({
    queryKey: productKeys.categories,
    queryFn: ({ signal }) => fetchCategories(signal),
    staleTime: 5 * 60_000,
  });
  const bestPrice = useQuery({
    queryKey: homeKeys.products('price_asc', BEST_PRICE_LIMIT),
    queryFn: ({ signal }) => fetchHomeProducts('price_asc', BEST_PRICE_LIMIT, signal),
  });
  const suggestions = useQuery({
    queryKey: homeKeys.products(tab, SUGGESTION_LIMIT),
    queryFn: ({ signal }) => fetchHomeProducts(tab, SUGGESTION_LIMIT, signal),
  });

  const changeTab = (next: HomeTab) => {
    const updated = new URLSearchParams(params);
    if (next === DEFAULT_HOME_TAB) updated.delete('tab');
    else updated.set('tab', next);
    setParams(updated, { replace: true });
  };

  const featured = topCategories(categories.data ?? [], 2);
  const chipClass =
    'flex shrink-0 items-center gap-space-xs rounded-lg px-space-md py-space-sm text-label-md shadow-card transition-colors';

  return (
    <div className="space-y-space-xl">
      <section aria-label="Lợi ích khi mua sắm">
        <ul className="grid grid-cols-2 gap-space-sm lg:grid-cols-4">
          {BENEFITS.map((benefit) => (
            <li
              key={benefit.title}
              className="flex items-center gap-space-sm rounded-lg bg-surface-container-low p-space-sm"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-primary">
                <Icon name={benefit.icon} className="text-lg" />
              </span>
              <span className="min-w-0">
                <span className="block text-title-sm text-on-surface">{benefit.title}</span>
                <span className="block text-body-sm text-on-surface-variant">{benefit.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Giới thiệu" className="grid gap-space-md lg:grid-cols-3">
        <div className="flex min-h-64 flex-col justify-between gap-space-lg rounded-xl bg-gradient-to-br from-primary to-primary-container p-space-lg text-on-primary md:p-space-xl lg:col-span-2">
          <div className="space-y-space-sm">
            <p className="text-label-md uppercase tracking-wider text-primary-fixed">ShopFast</p>
            <h1 className="text-headline-lg-mobile md:text-display-hero">
              Mua sắm nhanh, <span className="text-secondary-fixed-dim">đặt hàng dễ dàng</span>
            </h1>
            <p className="max-w-lg text-body-lg text-primary-fixed">
              Khám phá sản phẩm, đặt hàng trong vài bước và theo dõi đơn của bạn trực tiếp.
            </p>
          </div>
          <Link
            to="/san-pham"
            className="inline-flex h-12 w-fit items-center gap-space-sm rounded-lg bg-secondary-container px-space-xl text-title-md text-on-secondary hover:bg-secondary"
          >
            Khám phá ngay
            <Icon name="arrow_forward" className="text-lg" />
          </Link>
        </div>
        <div className="grid gap-space-md sm:grid-cols-2 lg:grid-cols-1">
          {featured.map((category) => (
            <Link
              key={category.id}
              to={categoryLink(category.id)}
              aria-label={`Danh mục ${category.name}`}
              className="flex items-center justify-between gap-space-md rounded-xl bg-surface-container-lowest p-space-lg shadow-card transition-shadow hover:shadow-card-hover"
            >
              <span className="min-w-0">
                <span className="block text-headline-sm text-on-surface">{category.name}</span>
                <span className="block text-body-sm text-on-surface-variant">
                  {formatNumber(category.productCount)} sản phẩm
                </span>
                <span className="mt-space-xs block text-label-md text-secondary">Xem ngay</span>
              </span>
              <Icon
                name={categoryIcon(category.slug)}
                className="text-5xl text-primary-fixed-dim"
              />
            </Link>
          ))}
        </div>
      </section>

      <section aria-label="Danh mục nổi bật" className="space-y-space-md">
        <SectionTitle>Danh mục nổi bật</SectionTitle>
        {categories.isPending ? (
          <div
            role="status"
            aria-label="Đang tải danh mục"
            className="flex animate-pulse gap-space-sm overflow-hidden"
          >
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-10 w-36 shrink-0 rounded-lg bg-surface-container-high" />
            ))}
          </div>
        ) : categories.isError ? (
          <RetryState title="Không tải được danh mục" query={categories} />
        ) : (
          <ul className="-mx-margin-mobile flex gap-space-sm overflow-x-auto px-margin-mobile pb-space-xs md:mx-0 md:px-0">
            <li className="shrink-0">
              <Link
                to="/san-pham"
                className={cn(chipClass, 'bg-primary-container text-on-primary')}
              >
                <Icon name="apps" className="text-lg" />
                Tất cả
              </Link>
            </li>
            {categories.data.map((category) => (
              <li key={category.id} className="shrink-0">
                <Link
                  to={categoryLink(category.id)}
                  className={cn(
                    chipClass,
                    'bg-surface-container-lowest text-on-surface hover:bg-primary-fixed',
                  )}
                >
                  <Icon name={categoryIcon(category.slug)} className="text-lg" />
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Giá tốt hôm nay" className="space-y-space-md">
        <div className="flex items-center justify-between gap-space-sm">
          <SectionTitle>Giá tốt hôm nay</SectionTitle>
          <Link
            to="/san-pham?sort=price_asc"
            className="flex shrink-0 items-center gap-space-xs text-title-sm text-secondary hover:underline"
          >
            Xem tất cả
            <Icon name="arrow_forward" className="text-lg" />
          </Link>
        </div>
        <ProductGrid
          query={bestPrice}
          skeleton={BEST_PRICE_LIMIT}
          errorTitle="Không tải được sản phẩm giá tốt"
        />
      </section>

      <section aria-label="Gợi ý hôm nay" className="space-y-space-md">
        <div className="flex flex-wrap items-center justify-between gap-space-sm">
          <SectionTitle>Gợi ý hôm nay</SectionTitle>
          <Tabs<HomeTab>
            variant="segmented"
            label="Sắp xếp gợi ý"
            value={tab}
            onChange={changeTab}
            items={HOME_TABS.map((item) => ({ value: item.value, label: item.label }))}
          />
        </div>
        <ProductGrid
          query={suggestions}
          skeleton={SUGGESTION_LIMIT}
          errorTitle="Không tải được sản phẩm gợi ý"
        />
        <div className="flex justify-center">
          <Link
            to={tab === DEFAULT_HOME_TAB ? '/san-pham' : `/san-pham?sort=${tab}`}
            className="inline-flex h-10 items-center gap-space-xs rounded-lg bg-surface-container-lowest px-space-lg text-title-sm text-primary shadow-card hover:bg-primary-fixed"
          >
            Xem thêm sản phẩm
            <Icon name="expand_more" className="text-lg" />
          </Link>
        </div>
      </section>
    </div>
  );
}
