// Trang chủ: tab sản phẩm theo các kiểu sắp xếp API hỗ trợ, thẻ danh mục nổi bật.

import { api } from '../api/client';
import type { CatalogFacet, ProductPage } from './product-api';
import type { ProductSort } from './product-filters';

export type HomeTab = Extract<ProductSort, 'newest' | 'price_asc' | 'name_asc'>;

export const HOME_TABS: ReadonlyArray<{ value: HomeTab; label: string }> = [
  { value: 'newest', label: 'Mới nhất' },
  { value: 'price_asc', label: 'Giá tốt' },
  { value: 'name_asc', label: 'A → Z' },
];

export const DEFAULT_HOME_TAB: HomeTab = 'newest';
/** Chia hết cho lưới 2 và 4 cột. */
export const SUGGESTION_LIMIT = 8;
export const BEST_PRICE_LIMIT = 4;

export function parseHomeTab(raw: string | null): HomeTab {
  return HOME_TABS.find((tab) => tab.value === raw)?.value ?? DEFAULT_HOME_TAB;
}

export const categoryLink = (id: number) => `/san-pham?categoryId=${id}`;

/** Danh mục nhiều sản phẩm nhất, bỏ danh mục rỗng. */
export function topCategories(categories: CatalogFacet[], count: number): CatalogFacet[] {
  return categories
    .filter((category) => category.productCount > 0)
    .sort((a, b) => b.productCount - a.productCount)
    .slice(0, count);
}

export const homeKeys = {
  products: (sort: ProductSort, limit: number) => ['products', 'home', sort, limit] as const,
};

export function fetchHomeProducts(
  sort: ProductSort,
  limit: number,
  signal?: AbortSignal,
): Promise<ProductPage> {
  return api.get<ProductPage>('/products', { query: { sort, limit }, signal, auth: false });
}
