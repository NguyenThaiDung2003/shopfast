import { api } from '../api/client';
import { isApiError } from '../api/errors';
import type { OrderStatus } from '../orders/order-status';

/** Khớp CartItemDto. */
export interface CartItem {
  productId: number;
  sku: string;
  name: string;
  slug: string;
  /** Giá hiện tại (VND); giá chốt khi đặt đơn. */
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  /** Tồn kho hiện tại. */
  available: number;
  /** Số lượng trong giỏ vượt tồn kho hiện tại. */
  insufficientStock: boolean;
}

export interface Cart {
  items: CartItem[];
  totalQuantity: number;
  subtotal: number;
}

/** Phần OrderDto trang giỏ cần. */
export interface Order {
  id: string;
  code: string;
  status: OrderStatus;
  totalAmount: number;
}

/** Khớp ShippingInfoDto. */
export interface ShippingInfo {
  recipientName: string;
  phone: string;
  address: string;
  note?: string;
}

/** `details` của 409 OUT_OF_STOCK khi đặt hàng. */
export interface Shortage {
  productId: number;
  sku: string;
  name: string;
  requested: number;
  available: number;
}

export function fetchCart(signal?: AbortSignal): Promise<Cart> {
  return api.get<Cart>('/cart', { signal });
}

export function updateCartItem(productId: number, quantity: number): Promise<Cart> {
  return api.patch<Cart>(`/cart/items/${productId}`, { quantity });
}

export function removeCartItem(productId: number): Promise<void> {
  return api.delete(`/cart/items/${productId}`);
}

export function clearCart(): Promise<void> {
  return api.delete('/cart');
}

/** Đặt toàn bộ giỏ; cùng `idempotencyKey` → server trả lại đúng đơn đã tạo (không tạo trùng). */
export function placeOrder(shipping: ShippingInfo, idempotencyKey: string): Promise<Order> {
  return api.post<Order>(
    '/orders',
    { shipping },
    {
      headers: { 'Idempotency-Key': idempotencyKey },
    },
  );
}

/** Danh sách sản phẩm thiếu hàng từ lỗi 409 OUT_OF_STOCK (rỗng nếu lỗi khác). */
export function readShortages(error: unknown): Shortage[] {
  if (!isApiError(error) || error.code !== 'OUT_OF_STOCK' || !Array.isArray(error.details)) {
    return [];
  }
  return (error.details as unknown[]).filter(
    (d): d is Shortage =>
      typeof d === 'object' &&
      d !== null &&
      typeof (d as Shortage).productId === 'number' &&
      typeof (d as Shortage).available === 'number',
  );
}
