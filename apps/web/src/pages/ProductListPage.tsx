import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../api/errors';
import { Breadcrumb } from '../components/Breadcrumb';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Modal,
  Pagination,
  Spinner,
} from '../components/ui';
import { cn } from '../lib/cn';
import { formatNumber } from '../lib/format';
import { ActiveFilterChips, type FilterKey } from '../products/ActiveFilterChips';
import {
  fetchBrands,
  fetchCategories,
  fetchProducts,
  productKeys,
  type Product,
} from '../products/product-api';
import { ProductCard } from '../products/ProductCard';
import {
  activeFilterCount,
  SORT_OPTIONS,
  toSearchParams,
  type ProductSort,
} from '../products/product-filters';
import { ProductFilterPanel, type AppliedFilterValues } from '../products/ProductFilterPanel';
import { ProductGridSkeleton } from '../products/ProductGridSkeleton';
import { useAddToCart } from '../products/useAddToCart';
import { useProductFilters } from '../products/useProductFilters';

const FACET_STALE_MS = 5 * 60_000;

/** Trang "Danh sách sản phẩm" (thiết kế apps/web/design/danh-sach-san-pham). */
export function ProductListPage() {
  const { filters, update, clear } = useProductFilters();
  const cart = useAddToCart();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const products = useQuery({
    queryKey: productKeys.list(filters),
    queryFn: ({ signal }) => fetchProducts(filters, signal),
    placeholderData: keepPreviousData,
  });
  const categories = useQuery({
    queryKey: productKeys.categories,
    queryFn: ({ signal }) => fetchCategories(signal),
    staleTime: FACET_STALE_MS,
  });
  const brands = useQuery({
    queryKey: productKeys.brands,
    queryFn: ({ signal }) => fetchBrands(signal),
    staleTime: FACET_STALE_MS,
  });

  const onAddToCart = (product: Product) => cart.add(product);

  const applyFilters = (values: AppliedFilterValues) => {
    update(values);
    setMobileFiltersOpen(false);
  };

  const clearFilters = () => {
    clear();
    setMobileFiltersOpen(false);
  };

  const removeFilter = (key: FilterKey) => {
    if (key === 'category') update({ categoryId: undefined });
    else if (key === 'brand') update({ brandId: undefined });
    else update({ minPrice: undefined, maxPrice: undefined });
  };

  const goToPage = (page: number) => {
    update({ page });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const category = categories.data?.find((c) => c.id === filters.categoryId);
  const data = products.data;
  const filterCount = activeFilterCount(filters);
  // Bản nháp trong panel khởi tạo lại mỗi khi bộ lọc áp dụng đổi (Back, bỏ chip…).
  const panelKey = toSearchParams({ ...filters, page: 1, sort: 'newest', view: 'grid' }).toString();
  const panelProps = {
    applied: filters,
    categories,
    brands,
    onApply: applyFilters,
    onClear: clearFilters,
  };

  const renderResults = () => {
    if (products.isPending) return <ProductGridSkeleton view={filters.view} />;

    if (products.isError && !data) {
      return (
        <Card>
          <EmptyState
            icon="cloud_off"
            title="Không tải được danh sách sản phẩm"
            description={errorMessage(products.error)}
            action={
              <Button
                variant="brand"
                icon="refresh"
                loading={products.isFetching}
                onClick={() => void products.refetch()}
              >
                Thử lại
              </Button>
            }
          />
        </Card>
      );
    }

    if (!data) return null;

    if (data.items.length === 0) {
      const outOfRange = data.meta.total > 0;
      return (
        <Card>
          <EmptyState
            icon={outOfRange ? 'last_page' : 'search_off'}
            title={outOfRange ? 'Trang này không có sản phẩm' : 'Không tìm thấy sản phẩm phù hợp'}
            description={
              outOfRange
                ? `Danh sách chỉ có ${formatNumber(data.meta.totalPages)} trang.`
                : 'Thử bỏ bớt bộ lọc hoặc chọn khoảng giá rộng hơn.'
            }
            action={
              outOfRange ? (
                <Button variant="brand" onClick={() => goToPage(1)}>
                  Về trang đầu
                </Button>
              ) : (
                filterCount > 0 && (
                  <Button variant="brand" icon="filter_alt_off" onClick={clearFilters}>
                    Xoá bộ lọc
                  </Button>
                )
              )
            }
          />
        </Card>
      );
    }

    const refreshing = products.isPlaceholderData && products.isFetching;
    return (
      <div className="relative" aria-busy={refreshing}>
        <div
          className={cn(
            'transition-opacity',
            refreshing && 'pointer-events-none opacity-50',
            filters.view === 'grid'
              ? 'grid grid-cols-2 gap-gutter-mobile md:grid-cols-3 md:gap-gutter xl:grid-cols-4'
              : 'space-y-space-md',
          )}
        >
          {data.items.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              view={filters.view}
              purchase={cart.purchase}
              adding={cart.pendingProductId === product.id}
              onAddToCart={onAddToCart}
            />
          ))}
        </div>
        {refreshing && (
          <div className="absolute inset-x-0 top-16 flex justify-center text-primary">
            <Spinner size="lg" label="Đang cập nhật danh sách" />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-space-lg">
      <Breadcrumb
        items={
          category
            ? [{ label: 'Danh sách sản phẩm', to: '/san-pham' }, { label: category.name }]
            : [{ label: 'Danh sách sản phẩm' }]
        }
      />

      <header className="space-y-space-sm">
        <Badge tone="primary" icon="verified_user" pill size="md" className="uppercase">
          100% sản phẩm phân phối chính hãng
        </Badge>
        <h1 className="text-headline-lg-mobile text-on-surface md:text-display-hero">
          {category?.name ?? 'Tất cả sản phẩm'}
        </h1>
        <p className="max-w-3xl text-body-lg text-on-surface-variant">
          Khám phá thiết bị thông minh, phụ kiện công nghệ và gia dụng điện tử với giá tốt nhất hôm
          nay.
        </p>
      </header>

      {filters.q && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-space-sm rounded-lg bg-primary-fixed/50 px-space-lg py-space-md text-body-md text-on-primary-fixed-variant"
        >
          <span className="flex items-center gap-space-sm">
            <Icon name="info" />
            Tìm theo từ khoá “{filters.q}” chưa được hỗ trợ, đang hiển thị toàn bộ sản phẩm.
          </span>
          <button
            type="button"
            onClick={() => update({ q: undefined })}
            className="font-semibold underline"
          >
            Bỏ từ khoá
          </button>
        </div>
      )}

      <div className="grid items-start gap-space-lg lg:grid-cols-12">
        <aside className="hidden lg:sticky lg:top-32 lg:col-span-3 lg:block">
          <Card className="p-space-lg">
            <ProductFilterPanel key={panelKey} {...panelProps} />
          </Card>
        </aside>

        <section className="min-w-0 space-y-space-md lg:col-span-9" aria-label="Kết quả">
          <Card className="flex flex-col gap-space-md p-space-md md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 flex-col gap-space-sm md:flex-row md:items-center md:gap-space-md">
              <p className="shrink-0 text-title-md text-on-surface" aria-live="polite">
                {data ? (
                  <>
                    Tìm thấy <span className="text-primary">{formatNumber(data.meta.total)}</span>{' '}
                    sản phẩm
                  </>
                ) : (
                  'Đang tìm sản phẩm…'
                )}
              </p>
              <ActiveFilterChips
                filters={filters}
                categories={categories.data}
                brands={brands.data}
                onRemove={removeFilter}
              />
            </div>
            <div className="flex flex-wrap items-center gap-space-sm md:shrink-0">
              <Button
                variant="outline"
                size="sm"
                icon="tune"
                className="lg:hidden"
                onClick={() => setMobileFiltersOpen(true)}
              >
                Bộ lọc{filterCount > 0 && ` (${filterCount})`}
              </Button>
              <label
                htmlFor="product-sort"
                className="hidden text-body-md text-on-surface-variant sm:block"
              >
                Sắp xếp theo:
              </label>
              <div className="relative">
                <select
                  id="product-sort"
                  value={filters.sort}
                  onChange={(e) => update({ sort: e.target.value as ProductSort })}
                  aria-label="Sắp xếp theo"
                  className="h-9 appearance-none rounded-lg border-0 bg-surface-container-low pl-space-md pr-9 text-title-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <Icon
                  name="expand_more"
                  className="pointer-events-none absolute right-space-sm top-1/2 -translate-y-1/2 text-outline"
                />
              </div>
              <div
                className="ml-auto flex rounded-lg bg-surface-container-low p-0.5"
                role="group"
                aria-label="Kiểu hiển thị"
              >
                {(
                  [
                    ['grid', 'grid_view', 'Dạng lưới'],
                    ['list', 'view_list', 'Dạng danh sách'],
                  ] as const
                ).map(([view, icon, label]) => (
                  <button
                    key={view}
                    type="button"
                    aria-pressed={filters.view === view}
                    aria-label={label}
                    onClick={() => update({ view })}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
                      filters.view === view
                        ? 'bg-surface-container-lowest text-primary shadow-card'
                        : 'text-on-surface-variant hover:text-on-surface',
                    )}
                  >
                    <Icon name={icon} />
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {renderResults()}

          {data && data.meta.total > 0 && data.items.length > 0 && (
            <Card className="p-space-md">
              <Pagination
                page={data.meta.page}
                pageSize={data.meta.limit}
                total={data.meta.total}
                onPageChange={goToPage}
                itemLabel="sản phẩm"
              />
            </Card>
          )}
        </section>
      </div>

      <Modal
        open={mobileFiltersOpen}
        onClose={() => setMobileFiltersOpen(false)}
        title="Bộ lọc tìm kiếm"
        icon="tune"
      >
        <ProductFilterPanel key={panelKey} {...panelProps} hideHeader />
      </Modal>
    </div>
  );
}
