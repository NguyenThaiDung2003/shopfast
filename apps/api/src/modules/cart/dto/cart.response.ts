export class CartItemDto {
  productId!: number;
  sku!: string;
  name!: string;
  slug!: string;
  /** Giá hiện tại (VND); giá chốt khi đặt đơn. */
  unitPrice!: number;
  quantity!: number;
  /** unitPrice × quantity (VND). */
  lineTotal!: number;
  /** Tồn kho hiện tại – để UI cảnh báo trước khi đặt. */
  available!: number;
  /** true nếu số lượng trong giỏ vượt tồn kho hiện tại. */
  insufficientStock!: boolean;
}

export class CartDto {
  items!: CartItemDto[];
  totalQuantity!: number;
  /** Tạm tính (VND). */
  subtotal!: number;
}
