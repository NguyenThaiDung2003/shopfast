import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  buildProductOrderBy,
  buildProductWhere,
  ProductFilter,
  ProductSort,
} from './catalog.query';

const categoryBrandSelect = { select: { id: true, name: true, slug: true } } as const;

const productListSelect = {
  id: true,
  sku: true,
  name: true,
  slug: true,
  price: true,
  stock: true,
  category: categoryBrandSelect,
  brand: categoryBrandSelect,
} satisfies Prisma.ProductSelect;

const productDetailSelect = {
  ...productListSelect,
  description: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

export type ProductListItem = Prisma.ProductGetPayload<{ select: typeof productListSelect }>;
export type ProductDetail = Prisma.ProductGetPayload<{ select: typeof productDetailSelect }>;

export interface ProductStock {
  id: number;
  sku: string;
  name: string;
  stock: number;
}

export interface PriceStock {
  price: number;
  stock: number;
}

/** Thay đổi cần áp: `stock` đặt tuyệt đối, `stockDelta` cộng/trừ – không dùng cả hai. */
export interface ProductPatch {
  price?: number;
  stock?: number;
  stockDelta?: number;
}

export type ApplyPatchResult =
  | { status: 'updated'; sku: string; before: PriceStock; after: PriceStock }
  | { status: 'not_found' }
  | { status: 'insufficient_stock'; available: number };

@Injectable()
export class CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPage(
    filter: ProductFilter,
    sort: ProductSort,
    skip: number,
    take: number,
  ): Promise<{ items: ProductListItem[]; total: number }> {
    const where = buildProductWhere(filter);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        select: productListSelect,
        orderBy: buildProductOrderBy(sort),
        skip,
        take,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items, total };
  }

  findById(id: number): Promise<ProductDetail | null> {
    return this.prisma.product.findUnique({ where: { id }, select: productDetailSelect });
  }

  findStockBySku(sku: string): Promise<ProductStock | null> {
    return this.prisma.product.findUnique({
      where: { sku },
      select: { id: true, sku: true, name: true, stock: true },
    });
  }

  /**
   * Áp giá/tồn kho bằng MỘT câu UPDATE nguyên tử, trả cả giá trị trước và sau.
   * - Subquery `FOR UPDATE` khoá dòng và đọc phiên bản mới nhất → request song song xếp hàng,
   *   không ghi đè lên nhau (không lost update).
   * - Điều kiện `stock + delta >= 0` nằm trong WHERE → không bao giờ trừ quá tồn kho.
   * Không dùng interactive transaction (SELECT rồi UPDATE qua nhiều round-trip): dưới tải
   * tranh chấp nó giữ connection trong lúc chờ khoá và làm cạn pool (Prisma P2028).
   */
  async applyPatch(id: number, patch: ProductPatch): Promise<ApplyPatchResult> {
    const price = patch.price ?? null;
    const stock = patch.stock ?? null;
    const delta = patch.stockDelta ?? null;

    const [row] = await this.prisma.$queryRaw<
      Array<{ sku: string; beforePrice: number; beforeStock: number } & PriceStock>
    >`
      UPDATE products AS p
      SET price = COALESCE(${price}::int, p.price),
          stock = COALESCE(${stock}::int, p.stock + COALESCE(${delta}::int, 0)),
          updated_at = now()
      FROM (SELECT id, price, stock FROM products WHERE id = ${id} FOR UPDATE) AS old
      WHERE p.id = old.id
        AND old.stock + COALESCE(${delta}::int, 0) >= 0
      RETURNING p.sku, old.price AS "beforePrice", old.stock AS "beforeStock", p.price, p.stock`;

    if (row) {
      return {
        status: 'updated',
        sku: row.sku,
        before: { price: row.beforePrice, stock: row.beforeStock },
        after: { price: row.price, stock: row.stock },
      };
    }

    // Không cập nhật được dòng nào: hoặc không tồn tại, hoặc không đủ hàng.
    const current = await this.prisma.product.findUnique({
      where: { id },
      select: { stock: true },
    });
    return current
      ? { status: 'insufficient_stock', available: current.stock }
      : { status: 'not_found' };
  }
}
