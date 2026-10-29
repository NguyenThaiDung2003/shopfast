import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { CartLine, CartRepository } from './cart.repository';
import { AddCartItemDto, MAX_CART_LINE_QUANTITY } from './dto/cart-item.dto';

export interface CartItemView {
  productId: number;
  sku: string;
  name: string;
  slug: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  /** Tồn kho hiện tại – để UI cảnh báo trước khi đặt. */
  available: number;
  insufficientStock: boolean;
}

export interface CartView {
  items: CartItemView[];
  totalQuantity: number;
  subtotal: number;
}

export function toCartView(lines: CartLine[]): CartView {
  const items = lines.map(({ productId, quantity, product }) => ({
    productId,
    sku: product.sku,
    name: product.name,
    slug: product.slug,
    unitPrice: product.price,
    quantity,
    lineTotal: product.price * quantity,
    available: product.stock,
    insufficientStock: quantity > product.stock,
  }));
  return {
    items,
    totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
    subtotal: items.reduce((sum, i) => sum + i.lineTotal, 0),
  };
}

/**
 * Giỏ hàng của customer. Kiểm tồn kho ở đây chỉ là kiểm "mềm" để báo sớm cho khách;
 * kiểm tra quyết định nằm ở lúc đặt đơn (UPDATE nguyên tử, ADR-0005).
 */
@Injectable()
export class CartService {
  constructor(private readonly cartRepository: CartRepository) {}

  async getCart(userId: string): Promise<CartView> {
    return toCartView(await this.cartRepository.findLines(userId));
  }

  async addItem(userId: string, { productId, quantity }: AddCartItemDto): Promise<CartView> {
    const current = (await this.cartRepository.findQuantity(userId, productId)) ?? 0;
    await this.saveQuantity(userId, productId, current + quantity);
    return this.getCart(userId);
  }

  async updateItem(userId: string, productId: number, quantity: number): Promise<CartView> {
    if ((await this.cartRepository.findQuantity(userId, productId)) === null) {
      throw cartItemNotFound();
    }
    await this.saveQuantity(userId, productId, quantity);
    return this.getCart(userId);
  }

  async removeItem(userId: string, productId: number): Promise<void> {
    if (!(await this.cartRepository.remove(userId, productId))) throw cartItemNotFound();
  }

  clear(userId: string): Promise<void> {
    return this.cartRepository.clear(userId);
  }

  private async saveQuantity(userId: string, productId: number, quantity: number): Promise<void> {
    if (quantity > MAX_CART_LINE_QUANTITY) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'CART_LINE_LIMIT',
        `Mỗi sản phẩm chỉ được thêm tối đa ${MAX_CART_LINE_QUANTITY} cái vào giỏ.`,
      );
    }
    const product = await this.cartRepository.findProduct(productId);
    if (!product) {
      throw new AppException(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm.');
    }
    if (quantity > product.stock) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'INSUFFICIENT_STOCK',
        product.stock === 0
          ? `Sản phẩm "${product.name}" đã hết hàng.`
          : `Sản phẩm "${product.name}" chỉ còn ${product.stock}, không đủ ${quantity}.`,
        { productId, requested: quantity, available: product.stock },
      );
    }
    await this.cartRepository.setQuantity(userId, productId, quantity);
  }
}

function cartItemNotFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    'CART_ITEM_NOT_FOUND',
    'Sản phẩm này không có trong giỏ hàng.',
  );
}
