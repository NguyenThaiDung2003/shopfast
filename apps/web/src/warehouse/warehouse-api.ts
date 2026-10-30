import { api } from '../api/client';
import type { MyOrderPage, Order } from '../orders/my-orders-api';
import type { OrderStatus } from '../orders/order-status';
import type { CatalogRef, PageMeta } from '../products/product-api';
import type { InventoryFilters } from './inventory-filters';
import type { WarehouseOrderFilters } from './orders-filters';

/** OrderDto nhân viên nhận thêm khách đặt đơn và các bước chuyển hợp lệ (ADR-0006). */
export interface StaffOrder extends Order {
  customer?: { id: string; fullName: string; email: string };
  nextStatuses?: OrderStatus[];
}

/** Khớp StaffOrderPageDto. */
export interface StaffOrderPage extends Omit<MyOrderPage, 'items'> {
  items: StaffOrder[];
}

/** Khớp InventoryItemDto. */
export interface InventoryItem {
  id: number;
  sku: string;
  name: string;
  slug: string;
  price: number;
  stock: number;
  imageUrl: string | null;
  /** Giá đã lưu; có thể không lớn hơn giá bán nếu giá vừa tăng. */
  compareAtPrice: number | null;
  category: CatalogRef;
  brand: CatalogRef;
  updatedAt: string;
}

/** Khớp InventorySummaryDto. */
export interface InventorySummary {
  totalSkus: number;
  lowStock: number;
  outOfStock: number;
  stockValue: number;
  lowStockThreshold: number;
}

export interface InventoryPage {
  items: InventoryItem[];
  meta: PageMeta;
  summary: InventorySummary;
}

export interface ProductPatch {
  price?: number;
  /** `null` = bỏ giảm giá. */
  compareAtPrice?: number | null;
  /** `null` = xoá ảnh. */
  imageUrl?: string | null;
  stock?: number;
  stockDelta?: number;
  /** Số tồn lúc bắt đầu kiểm kê; lệch → 409 STOCK_CHANGED. */
  expectedStock?: number;
}

/** Đơn kho tự làm mới định kỳ (đơn mới vào liên tục). */
export const WAREHOUSE_POLL_MS = 30_000;

export function staffOrdersQuery(filters: WarehouseOrderFilters) {
  return {
    status: filters.tab === 'all' ? undefined : filters.tab,
    q: filters.q,
    page: filters.page,
    limit: filters.limit,
  };
}

export function inventoryQuery(filters: InventoryFilters) {
  return { ...filters };
}

export const warehouseKeys = {
  ordersAll: ['warehouse', 'orders'] as const,
  orders: (filters: WarehouseOrderFilters) =>
    ['warehouse', 'orders', staffOrdersQuery(filters)] as const,
  inventoryAll: ['warehouse', 'inventory'] as const,
  inventory: (filters: InventoryFilters) =>
    ['warehouse', 'inventory', inventoryQuery(filters)] as const,
};

export function fetchStaffOrders(
  filters: WarehouseOrderFilters,
  signal?: AbortSignal,
): Promise<StaffOrderPage> {
  return api.get<StaffOrderPage>('/orders', { query: staffOrdersQuery(filters), signal });
}

export function changeOrderStatus(
  id: string,
  status: OrderStatus,
  note?: string,
): Promise<StaffOrder> {
  return api.patch<StaffOrder>(`/orders/${id}/status`, { status, note });
}

export function fetchInventory(
  filters: InventoryFilters,
  signal?: AbortSignal,
): Promise<InventoryPage> {
  return api.get<InventoryPage>('/products/inventory', { query: inventoryQuery(filters), signal });
}

export function updateProduct(id: number, patch: ProductPatch): Promise<InventoryItem> {
  return api.patch<InventoryItem>(`/products/${id}`, patch);
}
