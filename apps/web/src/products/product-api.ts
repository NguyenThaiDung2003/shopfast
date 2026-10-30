import { api } from '../api/client';
import { PAGE_SIZE, type ProductFilters } from './product-filters';

export interface CatalogRef {
  id: number;
  name: string;
  slug: string;
}

/** Khớp ProductListItemDto. */
export interface Product {
  id: number;
  sku: string;
  name: string;
  slug: string;
  /** VND. */
  price: number;
  stock: number;
  category: CatalogRef;
  brand: CatalogRef;
  /** Đường dẫn ảnh; null = chưa có ảnh. */
  imageUrl?: string | null;
  /** Giá gốc (VND), luôn lớn hơn giá bán; null = không giảm giá. */
  compareAtPrice?: number | null;
  /** Số lượng đã bán. */
  soldCount?: number;
}

/** Khớp ProductDetailDto. */
export interface ProductDetail extends Product {
  description: string | null;
  updatedAt: string;
}

/** Giới hạn id của API (ParseIdPipe: số nguyên 1..2^31-1). */
const MAX_INT32 = 2_147_483_647;

/** Id trên URL → số; sai định dạng → null (không gọi API, hiện "không tìm thấy"). */
export function parseProductId(raw: string | undefined): number | null {
  if (!raw || !/^\d{1,10}$/.test(raw)) return null;
  const id = Number(raw);
  return id >= 1 && id <= MAX_INT32 ? id : null;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ProductPage {
  items: Product[];
  meta: PageMeta;
}

/** Khớp CatalogFacetDto: danh mục/thương hiệu kèm tổng số sản phẩm. */
export interface CatalogFacet extends CatalogRef {
  productCount: number;
}

/** Tham số gửi API (bỏ `view`, `q` – chỉ dùng ở UI). */
export function productListQuery(filters: ProductFilters) {
  return {
    categoryId: filters.categoryId,
    brandId: filters.brandId,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    sort: filters.sort,
    page: filters.page,
    limit: PAGE_SIZE,
  };
}

export const productKeys = {
  all: ['products'] as const,
  list: (filters: ProductFilters) => ['products', 'list', productListQuery(filters)] as const,
  categories: ['catalog', 'categories'] as const,
  brands: ['catalog', 'brands'] as const,
  detail: (id: number) => ['products', 'detail', id] as const,
};

export const cartKeys = { all: ['cart'] as const };

export function fetchProducts(filters: ProductFilters, signal?: AbortSignal): Promise<ProductPage> {
  return api.get<ProductPage>('/products', {
    query: productListQuery(filters),
    signal,
    auth: false,
  });
}

export function fetchProduct(id: number, signal?: AbortSignal): Promise<ProductDetail> {
  return api.get<ProductDetail>(`/products/${id}`, { signal, auth: false });
}

export function fetchCategories(signal?: AbortSignal): Promise<CatalogFacet[]> {
  return api.get<CatalogFacet[]>('/categories', { signal, auth: false });
}

export function fetchBrands(signal?: AbortSignal): Promise<CatalogFacet[]> {
  return api.get<CatalogFacet[]>('/brands', { signal, auth: false });
}

export function addToCart(productId: number, quantity = 1): Promise<unknown> {
  return api.post('/cart/items', { productId, quantity });
}
