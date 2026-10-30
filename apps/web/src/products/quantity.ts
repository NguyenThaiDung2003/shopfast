// Số lượng mua: khớp AddCartItemDto của API (1–MAX_CART_LINE_QUANTITY) và tồn kho hiện có.

/** apps/api/src/modules/cart/dto/cart-item.dto.ts → MAX_CART_LINE_QUANTITY. */
export const MAX_LINE_QUANTITY = 99;

/** Số lớn nhất được chọn: không vượt tồn kho, không vượt giới hạn một dòng giỏ hàng. */
export function maxPurchasable(stock: number): number {
  return Math.max(0, Math.min(stock, MAX_LINE_QUANTITY));
}

export function clampQuantity(value: number, max: number): number {
  return Math.min(Math.max(1, Math.trunc(value)), Math.max(1, max));
}

/** Lỗi tiếng Việt cho ô số lượng; `undefined` = hợp lệ. */
export function validateQuantity(text: string, stock: number): string | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return 'Số lượng phải là số nguyên từ 1.';
  const quantity = Number(trimmed);
  if (quantity < 1) return 'Số lượng tối thiểu là 1.';
  if (quantity > stock) return `Chỉ còn ${stock} sản phẩm.`;
  if (quantity > MAX_LINE_QUANTITY) return `Mỗi lần tối đa ${MAX_LINE_QUANTITY} sản phẩm.`;
  return undefined;
}
