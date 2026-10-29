import { IsInt, Max, Min } from 'class-validator';

/** Số lượng tối đa của một sản phẩm trong giỏ; khớp CHECK cart_items_quantity_range. */
export const MAX_CART_LINE_QUANTITY = 99;

export class AddCartItemDto {
  @IsInt()
  @Min(1)
  productId!: number;

  @IsInt()
  @Min(1)
  @Max(MAX_CART_LINE_QUANTITY)
  quantity!: number;
}

export class UpdateCartItemDto {
  @IsInt()
  @Min(1)
  @Max(MAX_CART_LINE_QUANTITY)
  quantity!: number;
}
