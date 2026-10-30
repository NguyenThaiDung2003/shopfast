import { api } from '../api/client';
import type { PageMeta } from '../products/product-api';
import {
  ORDER_PAGE_SIZE,
  tabStatuses,
  type OrderFilters,
  type StatusCounts,
} from './my-orders-filters';
import type { OrderStatus } from './order-status';

/** Khớp OrderItemDto. */
export interface OrderItem {
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

/** Phần OrderDto trang lịch sử đơn dùng. */
export interface Order {
  id: string;
  code: string;
  status: OrderStatus;
  totalAmount: number;
  paidAt: string | null;
  createdAt: string;
  items: OrderItem[];
}

/** Khớp OrderStatusChangeDto (khách hàng không thấy id/tên nhân viên). */
export interface OrderStatusChange {
  from: OrderStatus | null;
  to: OrderStatus;
  note: string | null;
  changedAt: string;
}

/** Khớp OrderShippingDto. */
export interface OrderShipping {
  recipientName: string;
  phone: string;
  address: string;
  note: string | null;
}

/** OrderDto đầy đủ (GET /orders/:id). */
export interface OrderDetail extends Order {
  statusHistory: OrderStatusChange[];
  /** Thông tin nhận hàng; null ở đơn tạo trước khi có bước thanh toán. */
  shipping?: OrderShipping | null;
}

/** Khớp MyOrderPageDto. */
export interface MyOrderPage {
  items: Order[];
  meta: PageMeta;
  statusCounts: StatusCounts;
}

export function myOrdersQuery(filters: OrderFilters) {
  const statuses = tabStatuses(filters.tab);
  return {
    status: statuses.length > 0 ? statuses.join(',') : undefined,
    q: filters.q,
    page: filters.page,
    limit: ORDER_PAGE_SIZE,
  };
}

export const orderKeys = {
  allMine: ['orders', 'me'] as const,
  mine: (filters: OrderFilters) => ['orders', 'me', myOrdersQuery(filters)] as const,
  detail: (id: string) => ['orders', 'detail', id] as const,
  recent: ['orders', 'me', 'recent'] as const,
};

/** Số đơn gần nhất cho ô chọn "Mã đơn hàng liên quan" (limit tối đa của API). */
export const RECENT_ORDERS_LIMIT = 50;

export function fetchMyOrders(filters: OrderFilters, signal?: AbortSignal): Promise<MyOrderPage> {
  return api.get<MyOrderPage>('/orders/me', { query: myOrdersQuery(filters), signal });
}

export function fetchOrder(id: string, signal?: AbortSignal): Promise<OrderDetail> {
  return api.get<OrderDetail>(`/orders/${id}`, { signal });
}

export function fetchRecentOrders(signal?: AbortSignal): Promise<MyOrderPage> {
  return api.get<MyOrderPage>('/orders/me', { query: { limit: RECENT_ORDERS_LIMIT }, signal });
}
