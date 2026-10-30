import { Icon } from '../components/ui';
import { formatCompactPrice } from '../lib/format';
import type { CatalogFacet } from './product-api';
import type { ProductFilters } from './product-filters';

export type FilterKey = 'category' | 'brand' | 'price';

export interface ActiveFilterChipsProps {
  filters: ProductFilters;
  categories?: CatalogFacet[];
  brands?: CatalogFacet[];
  onRemove: (key: FilterKey) => void;
}

function nameOf(facets: CatalogFacet[] | undefined, id: number): string {
  return facets?.find((f) => f.id === id)?.name ?? `#${id}`;
}

function priceLabel(min?: number, max?: number): string {
  if (min !== undefined && max !== undefined) {
    return `${formatCompactPrice(min)} - ${formatCompactPrice(max)}`;
  }
  if (min !== undefined) return `từ ${formatCompactPrice(min)}`;
  return `đến ${formatCompactPrice(max ?? 0)}`;
}

/** Chip bộ lọc đang áp dụng; bấm × bỏ ngay (không cần "Áp dụng"). */
export function ActiveFilterChips({
  filters,
  categories,
  brands,
  onRemove,
}: ActiveFilterChipsProps) {
  const chips: Array<{ key: FilterKey; label: string }> = [];
  if (filters.categoryId !== undefined) {
    chips.push({ key: 'category', label: `Danh mục: ${nameOf(categories, filters.categoryId)}` });
  }
  if (filters.brandId !== undefined) {
    chips.push({ key: 'brand', label: `Thương hiệu: ${nameOf(brands, filters.brandId)}` });
  }
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    chips.push({ key: 'price', label: `Giá: ${priceLabel(filters.minPrice, filters.maxPrice)}` });
  }
  if (chips.length === 0) return null;

  return (
    <ul className="flex gap-space-sm overflow-x-auto" aria-label="Bộ lọc đang áp dụng">
      {chips.map((chip) => (
        <li key={chip.key} className="shrink-0">
          <span className="inline-flex items-center gap-space-xs rounded-full bg-primary-fixed py-space-xs pl-space-md pr-space-xs text-label-md text-on-primary-fixed-variant">
            {chip.label}
            <button
              type="button"
              onClick={() => onRemove(chip.key)}
              aria-label={`Bỏ lọc ${chip.label}`}
              className="flex h-5 w-5 items-center justify-center rounded-full transition-colors hover:bg-primary-fixed-dim"
            >
              <Icon name="close" className="text-sm" />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
