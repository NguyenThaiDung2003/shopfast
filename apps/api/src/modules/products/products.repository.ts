import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface ProductFilter {
  categoryId?: number;
  brandId?: number;
  minPrice?: number;
  maxPrice?: number;
}

const productListSelect = {
  id: true,
  sku: true,
  name: true,
  slug: true,
  price: true,
  stock: true,
  category: { select: { id: true, name: true, slug: true } },
  brand: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.ProductSelect;

export type ProductListItem = Prisma.ProductGetPayload<{ select: typeof productListSelect }>;

@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPage(
    filter: ProductFilter,
    skip: number,
    take: number,
  ): Promise<{ items: ProductListItem[]; total: number }> {
    const where: Prisma.ProductWhereInput = {
      categoryId: filter.categoryId,
      brandId: filter.brandId,
      price: { gte: filter.minPrice, lte: filter.maxPrice },
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        select: productListSelect,
        orderBy: { id: 'asc' },
        skip,
        take,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { items, total };
  }
}
