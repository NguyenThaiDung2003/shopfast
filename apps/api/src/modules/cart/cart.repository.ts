import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

const cartLineSelect = {
  productId: true,
  quantity: true,
  product: { select: { sku: true, name: true, slug: true, price: true, stock: true } },
} satisfies Prisma.CartItemSelect;

export type CartLine = Prisma.CartItemGetPayload<{ select: typeof cartLineSelect }>;

export interface CheckoutLine {
  productId: number;
  quantity: number;
}

@Injectable()
export class CartRepository {
  constructor(private readonly prisma: PrismaService) {}

  findLines(userId: string): Promise<CartLine[]> {
    return this.prisma.cartItem.findMany({
      where: { userId },
      select: cartLineSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Dòng giỏ tối giản để đặt hàng. */
  findCheckoutLines(userId: string): Promise<CheckoutLine[]> {
    return this.prisma.cartItem.findMany({
      where: { userId },
      select: { productId: true, quantity: true },
    });
  }

  async findQuantity(userId: string, productId: number): Promise<number | null> {
    const line = await this.prisma.cartItem.findUnique({
      where: { userId_productId: { userId, productId } },
      select: { quantity: true },
    });
    return line?.quantity ?? null;
  }

  findProduct(productId: number): Promise<{ name: string; stock: number } | null> {
    return this.prisma.product.findUnique({
      where: { id: productId },
      select: { name: true, stock: true },
    });
  }

  async setQuantity(userId: string, productId: number, quantity: number): Promise<void> {
    await this.prisma.cartItem.upsert({
      where: { userId_productId: { userId, productId } },
      create: { userId, productId, quantity },
      update: { quantity },
    });
  }

  async remove(userId: string, productId: number): Promise<boolean> {
    const { count } = await this.prisma.cartItem.deleteMany({ where: { userId, productId } });
    return count > 0;
  }

  async clear(userId: string): Promise<void> {
    await this.prisma.cartItem.deleteMany({ where: { userId } });
  }
}
