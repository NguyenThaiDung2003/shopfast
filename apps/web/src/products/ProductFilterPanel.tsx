import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Icon, Input, Spinner } from '../components/ui';
import { cn } from '../lib/cn';
import { formatNumber } from '../lib/format';
import type { CatalogFacet } from './product-api';
import {
  formatMoneyInput,
  hasErrors,
  parseMoneyInput,
  PRICE_PRESETS,
  SLIDER_MAX,
  SLIDER_STEP,
  validatePriceDraft,
  type ProductFilters,
} from './product-filters';

/** Phần kết quả TanStack Query mà panel cần (không phụ thuộc kiểu UseQueryResult đầy đủ). */
export interface FacetSource {
  data?: CatalogFacet[];
  isPending: boolean;
  isError: boolean;
  refetch: () => unknown;
}

export interface AppliedFilterValues {
  categoryId?: number;
  brandId?: number;
  minPrice?: number;
  maxPrice?: number;
}

export interface ProductFilterPanelProps {
  /** Bộ lọc đang áp dụng (URL) – giá trị khởi tạo cho bản nháp. */
  applied: ProductFilters;
  categories: FacetSource;
  brands: FacetSource;
  onApply: (values: AppliedFilterValues) => void;
  onClear: () => void;
  /** Ẩn tiêu đề "Bộ lọc tìm kiếm" (khi nằm trong Modal đã có tiêu đề). */
  hideHeader?: boolean;
}

function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const contentId = useId();
  return (
    <section className="border-b border-surface-container-high py-space-lg last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex w-full items-center justify-between text-title-md text-on-surface"
      >
        {title}
        <Icon name={open ? 'expand_less' : 'expand_more'} className="text-outline" />
      </button>
      <div id={contentId} hidden={!open} className="mt-space-md">
        {children}
      </div>
    </section>
  );
}

interface FacetListProps {
  name: string;
  legend: string;
  allLabel: string;
  source: FacetSource;
  items: CatalogFacet[] | undefined;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}

/** Danh sách chọn một (API chỉ nhận một categoryId/brandId), có mục "Tất cả". */
function FacetList({ name, legend, allLabel, source, items, value, onChange }: FacetListProps) {
  if (source.isPending) {
    return (
      <div className="flex items-center gap-space-sm py-space-sm text-body-sm text-on-surface-variant">
        <Spinner size="sm" className="text-primary" /> Đang tải…
      </div>
    );
  }
  if (source.isError) {
    return (
      <div className="flex items-center justify-between gap-space-sm rounded-lg bg-error-container/60 px-space-md py-space-sm text-body-sm text-on-error-container">
        Không tải được {legend.toLowerCase()}.
        <button type="button" onClick={() => source.refetch()} className="font-semibold underline">
          Thử lại
        </button>
      </div>
    );
  }

  const option = (id: number | undefined, label: string, count?: number) => (
    <label
      key={id ?? 'all'}
      className="flex cursor-pointer items-center gap-space-sm rounded py-1.5 text-body-md text-on-surface hover:text-primary"
    >
      <input
        type="radio"
        name={name}
        checked={value === id}
        onChange={() => onChange(id)}
        className="h-4 w-4 shrink-0 accent-primary-container"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span className="text-body-sm text-on-surface-variant">({formatNumber(count)})</span>
      )}
    </label>
  );

  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      {option(undefined, allLabel)}
      {items?.map((item) => option(item.id, item.name, item.productCount))}
      {items?.length === 0 && (
        <p className="py-space-xs text-body-sm text-on-surface-variant">Không có kết quả.</p>
      )}
    </fieldset>
  );
}

/** Thanh trượt hai đầu cho khoảng giá (đồng bộ với hai ô nhập). */
function PriceSlider({
  min,
  max,
  onChange,
}: {
  min: number;
  max: number;
  onChange: (min: number, max: number) => void;
}) {
  const left = (Math.min(min, SLIDER_MAX) / SLIDER_MAX) * 100;
  const right = (Math.min(max, SLIDER_MAX) / SLIDER_MAX) * 100;
  return (
    <div className="relative mx-space-sm h-6">
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-container-high" />
      <div
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-secondary-container"
        style={{ left: `${left}%`, right: `${100 - right}%` }}
      />
      <input
        type="range"
        className="dual-range"
        min={0}
        max={SLIDER_MAX}
        step={SLIDER_STEP}
        value={Math.min(min, SLIDER_MAX)}
        onChange={(e) => onChange(Math.min(Number(e.target.value), max), max)}
        aria-label="Giá tối thiểu"
      />
      <input
        type="range"
        className="dual-range"
        min={0}
        max={SLIDER_MAX}
        step={SLIDER_STEP}
        value={Math.min(max, SLIDER_MAX)}
        onChange={(e) => onChange(min, Math.max(Number(e.target.value), min))}
        aria-label="Giá tối đa"
      />
    </div>
  );
}

/**
 * Bộ lọc cột trái (thiết kế "Bộ lọc tìm kiếm"). Chọn trong panel là BẢN NHÁP; chỉ "Áp dụng bộ lọc"
 * mới ghi lên URL. Nơi dùng đổi `key` khi bộ lọc áp dụng đổi để khởi tạo lại bản nháp.
 */
export function ProductFilterPanel({
  applied,
  categories,
  brands,
  onApply,
  onClear,
  hideHeader,
}: ProductFilterPanelProps) {
  const [categoryId, setCategoryId] = useState(applied.categoryId);
  const [brandId, setBrandId] = useState(applied.brandId);
  const [minText, setMinText] = useState(formatMoneyInput(applied.minPrice));
  const [maxText, setMaxText] = useState(formatMoneyInput(applied.maxPrice));
  const [errors, setErrors] = useState<{ min?: string; max?: string }>({});
  const [brandQuery, setBrandQuery] = useState('');

  const minValue = parseMoneyInput(minText);
  const maxValue = parseMoneyInput(maxText);
  const sliderMin = minValue !== undefined && !Number.isNaN(minValue) ? minValue : 0;
  const sliderMax = maxValue !== undefined && !Number.isNaN(maxValue) ? maxValue : SLIDER_MAX;

  const setPrice = (min: number | undefined, max: number | undefined) => {
    setMinText(formatMoneyInput(min));
    setMaxText(formatMoneyInput(max));
    setErrors({});
  };

  const normalizedQuery = brandQuery.trim().toLowerCase();
  const visibleBrands = normalizedQuery
    ? brands.data?.filter((b) => b.name.toLowerCase().includes(normalizedQuery) || b.id === brandId)
    : brands.data;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validatePriceDraft(minText, maxText);
    setErrors(result.errors);
    if (hasErrors(result)) return;
    onApply({ categoryId, brandId, minPrice: result.minPrice, maxPrice: result.maxPrice });
  };

  /** Rời ô nhập: chuẩn hoá "2000000" → "2.000.000" nếu hợp lệ. */
  const normalize = (text: string, set: (v: string) => void) => {
    const value = parseMoneyInput(text);
    if (value !== undefined && !Number.isNaN(value)) set(formatMoneyInput(value));
  };

  return (
    <form onSubmit={submit} noValidate aria-label="Bộ lọc sản phẩm">
      {!hideHeader && (
        <div className="flex items-center justify-between pb-space-xs">
          <h2 className="flex items-center gap-space-sm text-headline-sm text-on-surface">
            <Icon name="tune" className="text-primary" />
            Bộ lọc tìm kiếm
          </h2>
          <button
            type="button"
            onClick={onClear}
            className="text-label-md text-secondary-container hover:text-secondary"
          >
            Đặt lại
          </button>
        </div>
      )}

      <FilterSection title="Danh mục sản phẩm">
        <FacetList
          name="category"
          legend="Danh mục"
          allLabel="Tất cả danh mục"
          source={categories}
          items={categories.data}
          value={categoryId}
          onChange={setCategoryId}
        />
      </FilterSection>

      <FilterSection title="Thương hiệu">
        {(brands.data?.length ?? 0) > 6 && (
          <Input
            icon="search"
            placeholder="Tìm thương hiệu…"
            aria-label="Tìm thương hiệu"
            value={brandQuery}
            onChange={(e) => setBrandQuery(e.target.value)}
            containerClassName="mb-space-sm"
            className="h-9 md:h-9"
          />
        )}
        <div className="max-h-72 overflow-y-auto pr-space-xs">
          <FacetList
            name="brand"
            legend="Thương hiệu"
            allLabel="Tất cả thương hiệu"
            source={brands}
            items={visibleBrands}
            value={brandId}
            onChange={setBrandId}
          />
        </div>
      </FilterSection>

      <FilterSection title="Khoảng giá (₫)">
        <div className="grid grid-cols-2 gap-space-sm">
          <Input
            label="Tối thiểu"
            inputMode="numeric"
            placeholder="0"
            value={minText}
            onChange={(e) => {
              setMinText(e.target.value);
              setErrors((prev) => ({ ...prev, min: undefined }));
            }}
            onBlur={() => normalize(minText, setMinText)}
            error={errors.min}
          />
          <Input
            label="Tối đa"
            inputMode="numeric"
            placeholder="Không giới hạn"
            value={maxText}
            onChange={(e) => {
              setMaxText(e.target.value);
              setErrors((prev) => ({ ...prev, max: undefined }));
            }}
            onBlur={() => normalize(maxText, setMaxText)}
            error={errors.max}
          />
        </div>
        <div className="mt-space-md">
          <PriceSlider
            min={sliderMin}
            max={sliderMax}
            onChange={(min, max) => setPrice(min || undefined, max >= SLIDER_MAX ? undefined : max)}
          />
        </div>
        <div className="mt-space-md grid grid-cols-2 gap-space-xs">
          {PRICE_PRESETS.map((preset) => {
            const active = minValue === preset.min && maxValue === preset.max;
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={active}
                onClick={() => setPrice(preset.min, preset.max)}
                className={cn(
                  'rounded py-1.5 text-label-md transition-colors',
                  active
                    ? 'bg-primary-container text-on-primary'
                    : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high',
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </FilterSection>

      <div className="space-y-space-sm pt-space-lg">
        <Button type="submit" icon="check" fullWidth>
          Áp dụng bộ lọc
        </Button>
        <Button variant="tonal" fullWidth onClick={onClear}>
          Xoá bộ lọc
        </Button>
      </div>
    </form>
  );
}
