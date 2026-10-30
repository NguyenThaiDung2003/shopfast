import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api/errors';
import { useSession } from '../auth/useAuth';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Pagination,
  SearchInput,
  Select,
  Table,
  useToast,
  type TableColumn,
} from '../components/ui';
import { cn } from '../lib/cn';
import { formatCompactPrice, formatDateTime, formatNumber, formatPrice } from '../lib/format';
import { fetchCategories, productKeys } from '../products/product-api';
import { ProductImage } from '../products/ProductImage';
import { AdjustStockModal } from '../warehouse/AdjustStockModal';
import {
  INVENTORY_PAGE_SIZES,
  INVENTORY_SORTS,
  parseInventoryFilters,
  STOCK_LEVEL_LABEL,
  STOCK_LEVELS,
  stockLevelOf,
  toInventorySearchParams,
  validateInventorySearch,
  type InventoryFilters,
  type InventorySort,
  type StockLevel,
} from '../warehouse/inventory-filters';
import { StockCountEditor } from '../warehouse/StockCountEditor';
import { fetchInventory, warehouseKeys, type InventoryItem } from '../warehouse/warehouse-api';

/** Ngưỡng hiển thị khi chưa có `summary` (chỉ để dựng nhãn bộ lọc trước khi tải xong). */
const FALLBACK_THRESHOLD = 5;

/** Trang "Quản lý tồn kho" (thiết kế quan-ly-ton-kho). */
export function InventoryPage() {
  const toast = useToast();
  const session = useSession();
  const canEditPrice = session?.user.role === 'ADMIN';
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseInventoryFilters(params), [params]);
  const [editing, setEditing] = useState<number>();
  const [adjusting, setAdjusting] = useState<InventoryItem>();

  const update = useCallback(
    (patch: Partial<InventoryFilters>) =>
      setParams(toInventorySearchParams({ ...filters, page: 1, ...patch })),
    [filters, setParams],
  );

  const query = useQuery({
    queryKey: warehouseKeys.inventory(filters),
    queryFn: ({ signal }) => fetchInventory(filters, signal),
    placeholderData: keepPreviousData,
  });
  const categories = useQuery({
    queryKey: productKeys.categories,
    queryFn: ({ signal }) => fetchCategories(signal),
    staleTime: 5 * 60_000,
  });

  const data = query.data;
  const summary = data?.summary;
  const threshold = summary?.lowStockThreshold ?? FALLBACK_THRESHOLD;
  const categoryName = categories.data?.find((c) => c.id === filters.categoryId)?.name;

  const copySku = (sku: string) => {
    void navigator.clipboard?.writeText(sku).then(
      () => toast.show({ tone: 'info', title: `Đã sao chép SKU ${sku}` }),
      () => undefined,
    );
  };

  const columns: TableColumn<InventoryItem>[] = [
    {
      key: 'sku',
      header: 'Mã SKU',
      render: (item) => {
        const level = stockLevelOf(item.stock, threshold);
        return (
          <div className="space-y-space-xs">
            <div className="flex items-center gap-space-xs">
              <span className="rounded bg-surface-container-low px-1.5 py-0.5 font-mono text-label-md text-on-surface">
                {item.sku}
              </span>
              <button
                type="button"
                onClick={() => copySku(item.sku)}
                aria-label={`Sao chép SKU ${item.sku}`}
                className="rounded p-0.5 text-outline hover:text-primary"
              >
                <Icon name="content_copy" className="text-base" />
              </button>
            </div>
            <p
              className={cn(
                'text-label-sm uppercase',
                level.level === 'out'
                  ? 'text-error'
                  : level.level === 'low'
                    ? 'text-secondary'
                    : 'text-tertiary-container',
              )}
            >
              {level.tag}
            </p>
          </div>
        );
      },
    },
    {
      key: 'product',
      header: 'Sản phẩm',
      className: 'min-w-[200px]',
      render: (item) => (
        <div className="flex items-center gap-space-sm">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-container-low">
            <ProductImage
              key={item.imageUrl}
              src={item.imageUrl}
              name={item.name}
              categorySlug={item.category.slug}
            />
          </span>
          <div className="min-w-0">
            <p className="line-clamp-2 text-title-sm text-on-surface">{item.name}</p>
            <p className="text-body-sm text-on-surface-variant">{item.brand.name}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Danh mục',
      render: (item) => <span className="text-body-md text-on-surface">{item.category.name}</span>,
    },
    {
      key: 'price',
      header: 'Giá bán',
      align: 'right',
      render: (item) => (
        <span className="whitespace-nowrap text-price-sm text-on-surface">
          {formatPrice(item.price)}
        </span>
      ),
    },
    {
      key: 'stock',
      header: 'Số lượng tồn kho',
      className: 'min-w-[240px]',
      render: (item) => {
        if (editing === item.id) {
          return <StockCountEditor item={item} onDone={() => setEditing(undefined)} />;
        }
        const level = stockLevelOf(item.stock, threshold);
        return (
          <div className="space-y-space-xs">
            <div className="flex flex-wrap items-center gap-space-sm">
              <span
                className={cn(
                  'text-headline-sm',
                  level.level === 'ok' ? 'text-on-surface' : 'text-error',
                )}
              >
                {formatNumber(item.stock)}
              </span>
              <Badge tone={level.tone} pill>
                {level.label}
              </Badge>
            </div>
            <p className="text-label-sm text-on-surface-variant">
              Cập nhật {formatDateTime(item.updatedAt)}
            </p>
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: 'Thao tác',
      align: 'right',
      className: 'min-w-[200px]',
      render: (item) => (
        <div className="flex flex-wrap justify-end gap-space-xs">
          <Button
            size="sm"
            variant="tonal"
            icon="fact_check"
            disabled={editing === item.id}
            aria-label={`Kiểm kê ${item.sku}`}
            onClick={() => setEditing(item.id)}
          >
            Kiểm kê
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon="swap_vert"
            aria-label={`Nhập/Xuất ${item.sku}`}
            onClick={() => setAdjusting(item)}
          >
            Nhập/Xuất
          </Button>
        </div>
      ),
    },
  ];

  const filtered = Boolean(filters.q || filters.categoryId || filters.stockLevel);
  const clearFilters = () =>
    setParams(
      toInventorySearchParams({
        ...filters,
        q: undefined,
        categoryId: undefined,
        stockLevel: undefined,
        page: 1,
      }),
    );

  const statCards: Array<{
    key: string;
    label: string;
    value: string;
    unit?: string;
    note: string;
    icon: string;
    level?: StockLevel;
    tone: string;
  }> = summary
    ? [
        {
          key: 'total',
          label: 'Tổng mặt hàng quản lý',
          value: formatNumber(summary.totalSkus),
          unit: 'SKU',
          note: 'Toàn bộ sản phẩm đang bán',
          icon: 'inventory_2',
          tone: 'bg-surface-container-lowest',
        },
        {
          key: 'low',
          label: `Cảnh báo sắp hết (< ${formatNumber(threshold)} chiếc)`,
          value: formatNumber(summary.lowStock),
          unit: 'SKU',
          note: 'Bấm để lọc và lập kế hoạch nhập',
          icon: 'warning',
          level: 'low',
          tone: 'bg-error-container/40',
        },
        {
          key: 'out',
          label: 'Đã hết hàng',
          value: formatNumber(summary.outOfStock),
          unit: 'SKU',
          note: 'Khách không đặt được các SKU này',
          icon: 'remove_shopping_cart',
          level: 'out',
          tone: 'bg-surface-container-lowest',
        },
        {
          key: 'value',
          label: 'Giá trị tồn kho (theo giá bán)',
          value: formatCompactPrice(summary.stockValue),
          note: 'Tổng giá bán × số lượng tồn',
          icon: 'account_balance_wallet',
          tone: 'bg-surface-container-lowest',
        },
      ]
    : [];

  return (
    <div className="space-y-space-lg">
      <div className="flex flex-wrap items-center justify-between gap-space-md">
        <div className="space-y-space-xs">
          <h1 className="flex flex-wrap items-center gap-space-md text-headline-lg-mobile text-on-surface md:text-headline-lg">
            Quản lý tồn kho sản phẩm
            {summary && (
              <span className="rounded-full bg-primary-fixed px-space-md py-space-xs text-label-md text-on-primary-fixed">
                {formatNumber(summary.totalSkus)} SKU
              </span>
            )}
          </h1>
          <p className="text-body-md text-on-surface-variant">
            Số liệu đọc trực tiếp từ hệ thống, cập nhật ngay sau mỗi lần kiểm kê hoặc nhập/xuất kho.
          </p>
        </div>
        <Button
          variant="outline"
          icon="refresh"
          loading={query.isFetching && !query.isPending}
          onClick={() => void query.refetch()}
        >
          Làm mới
        </Button>
      </div>

      {summary ? (
        <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-4">
          {statCards.map((card) => {
            const content = (
              <>
                <span className="flex items-start justify-between gap-space-sm">
                  <span className="text-body-md text-on-surface-variant">{card.label}</span>
                  <Icon name={card.icon} className="text-xl text-primary" />
                </span>
                <span className="block text-headline-lg text-on-surface">
                  {card.value}
                  {card.unit && (
                    <span className="ml-space-xs text-body-md text-on-surface-variant">
                      {card.unit}
                    </span>
                  )}
                </span>
                <span className="block text-body-sm text-on-surface-variant">{card.note}</span>
              </>
            );
            const className = cn(
              'flex flex-col gap-space-xs rounded-xl p-space-lg text-left shadow-card',
              card.tone,
            );
            return card.level ? (
              <button
                key={card.key}
                type="button"
                aria-pressed={filters.stockLevel === card.level}
                onClick={() =>
                  update({ stockLevel: filters.stockLevel === card.level ? undefined : card.level })
                }
                className={cn(
                  className,
                  'transition-shadow hover:shadow-card-hover',
                  filters.stockLevel === card.level && 'ring-2 ring-primary',
                )}
              >
                {content}
              </button>
            ) : (
              <div key={card.key} className={className}>
                {content}
              </div>
            );
          })}
        </div>
      ) : (
        query.isPending && (
          <div
            role="status"
            aria-label="Đang tải số liệu tồn kho"
            className="grid animate-pulse grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-4"
          >
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-32 rounded-xl bg-surface-container-low" />
            ))}
          </div>
        )
      )}

      <Card flush className="overflow-hidden">
        <div className="space-y-space-md border-b border-surface-container-high p-space-md">
          <div className="grid grid-cols-1 gap-space-md md:grid-cols-2 xl:grid-cols-4">
            <SearchInput
              key={filters.q ?? ''}
              initial={filters.q ?? ''}
              onSearch={(q) => update({ q })}
              validate={validateInventorySearch}
              label="Tìm theo SKU hoặc tên sản phẩm"
              placeholder="Tìm SKU hoặc tên sản phẩm…"
            />
            <Select
              label={<span className="sr-only">Danh mục</span>}
              value={filters.categoryId ? String(filters.categoryId) : ''}
              onChange={(e) =>
                update({ categoryId: e.target.value ? Number(e.target.value) : undefined })
              }
              options={[
                { value: '', label: 'Tất cả danh mục' },
                ...(categories.data ?? []).map((c) => ({ value: String(c.id), label: c.name })),
              ]}
            />
            <Select
              label={<span className="sr-only">Mức tồn</span>}
              value={filters.stockLevel ?? ''}
              onChange={(e) =>
                update({ stockLevel: (e.target.value || undefined) as StockLevel | undefined })
              }
              options={[
                { value: '', label: 'Mọi mức tồn' },
                ...STOCK_LEVELS.map((level) => ({
                  value: level,
                  label: STOCK_LEVEL_LABEL[level](threshold),
                })),
              ]}
            />
            <Select
              label={<span className="sr-only">Sắp xếp</span>}
              value={filters.sort}
              onChange={(e) => update({ sort: e.target.value as InventorySort })}
              options={INVENTORY_SORTS.map((s) => ({ value: s.value, label: s.label }))}
            />
          </div>
          {filtered && (
            <div className="flex flex-wrap items-center gap-space-sm text-body-sm">
              <span className="text-on-surface-variant">Bộ lọc đang áp dụng:</span>
              {filters.q && (
                <FilterChip
                  label={`Từ khoá: "${filters.q}"`}
                  onRemove={() => update({ q: undefined })}
                />
              )}
              {filters.categoryId && (
                <FilterChip
                  label={`Danh mục: ${categoryName ?? `#${filters.categoryId}`}`}
                  onRemove={() => update({ categoryId: undefined })}
                />
              )}
              {filters.stockLevel && (
                <FilterChip
                  label={`Mức tồn: ${STOCK_LEVEL_LABEL[filters.stockLevel](threshold)}`}
                  onRemove={() => update({ stockLevel: undefined })}
                />
              )}
              <button
                type="button"
                onClick={clearFilters}
                className="text-label-md text-primary hover:underline"
              >
                Xoá tất cả bộ lọc
              </button>
            </div>
          )}
        </div>

        {query.isError && !data ? (
          <EmptyState
            icon="cloud_off"
            title="Không tải được tồn kho"
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
        ) : (
          <Table
            caption="Danh sách tồn kho"
            columns={columns}
            rows={data?.items}
            rowKey={(item) => item.id}
            loading={query.isPending || (query.isPlaceholderData && query.isFetching)}
            rowClassName={(item) =>
              stockLevelOf(item.stock, threshold).level === 'ok'
                ? undefined
                : 'bg-error-container/20'
            }
            empty={
              filtered ? (
                <EmptyState
                  icon="search_off"
                  title="Không có sản phẩm phù hợp"
                  action={
                    <Button variant="brand" onClick={clearFilters}>
                      Xoá bộ lọc
                    </Button>
                  }
                />
              ) : (
                <EmptyState icon="inventory_2" title="Chưa có sản phẩm nào" />
              )
            }
          />
        )}

        {data && data.meta.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-space-md border-t border-surface-container-high p-space-md">
            <Pagination
              page={data.meta.page}
              pageSize={data.meta.limit}
              total={data.meta.total}
              onPageChange={(page) => update({ page })}
              itemLabel="SKU"
              className="flex-1"
            />
            <Select
              label="Số dòng"
              value={String(filters.limit)}
              onChange={(e) => update({ limit: Number(e.target.value) })}
              options={INVENTORY_PAGE_SIZES.map((size) => ({
                value: String(size),
                label: `${size} dòng`,
              }))}
              containerClassName="w-32"
            />
          </div>
        )}
      </Card>

      {adjusting && (
        <AdjustStockModal
          item={adjusting}
          canEditPrice={canEditPrice}
          onClose={() => setAdjusting(undefined)}
        />
      )}
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-space-xs rounded-full bg-primary-fixed px-space-sm py-0.5 text-label-md text-on-primary-fixed">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Bỏ lọc ${label}`}
        className="rounded-full hover:text-error"
      >
        <Icon name="close" className="text-sm" />
      </button>
    </span>
  );
}
