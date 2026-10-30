import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { InventorySort, StockLevel } from './dto/inventory.query';
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

const productCatalogSelect = {
  ...productListSelect,
  imageUrl: true,
  compareAtPrice: true,
} satisfies Prisma.ProductSelect;

const productDetailSelect = {
  ...productCatalogSelect,
  description: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

// Giá gốc giữ nguyên giá trị đã lưu (không ẩn như catalog) để ADMIN thấy và sửa được.
const inventorySelect = { ...productCatalogSelect, updatedAt: true } satisfies Prisma.ProductSelect;

/** Số đã bán, tính từ đơn chưa huỷ. */
interface SalesInfo {
  soldCount: number;
}

export type ProductListItem = Prisma.ProductGetPayload<{ select: typeof productCatalogSelect }> &
  SalesInfo;
export type InventoryItem = Prisma.ProductGetPayload<{ select: typeof inventorySelect }>;

export interface InventoryFilter {
  q?: string;
  categoryId?: number;
  stockLevel?: StockLevel;
  /** Ngưỡng "sắp hết". */
  threshold: number;
}

export interface InventorySummary {
  totalSkus: number;
  lowStock: number;
  outOfStock: number;
  stockValue: number;
}

const INVENTORY_ORDER: Record<InventorySort, Prisma.ProductOrderByWithRelationInput[]> = {
  [InventorySort.STOCK_ASC]: [{ stock: 'asc' }, { id: 'asc' }],
  [InventorySort.STOCK_DESC]: [{ stock: 'desc' }, { id: 'asc' }],
  [InventorySort.SKU]: [{ sku: 'asc' }],
  [InventorySort.UPDATED]: [{ updatedAt: 'desc' }, { id: 'asc' }],
};

function stockWhere(level: StockLevel, threshold: number): Prisma.IntFilter {
  switch (level) {
    case StockLevel.OUT:
      return { equals: 0 };
    case StockLevel.LOW:
      return { gt: 0, lt: threshold };
    case StockLevel.OK:
      return { gte: threshold };
  }
}
export type ProductDetail = Prisma.ProductGetPayload<{ select: typeof productDetailSelect }> &
  SalesInfo;

export interface ProductStock {
  id: number;
  sku: string;
  name: string;
  stock: number;
}

export interface ProductValues {
  price: number;
  stock: number;
  imageUrl: string | null;
  compareAtPrice: number | null;
}

/**
 * Thay đổi cần áp: `stock` đặt tuyệt đối, `stockDelta` cộng/trừ – không dùng cả hai.
 * `imageUrl`, `compareAtPrice`: `undefined` = giữ nguyên, `null` = xoá.
 */
export interface ProductPatch {
  price?: number;
  compareAtPrice?: number | null;
  imageUrl?: string | null;
  stock?: number;
  stockDelta?: number;
  /** Chỉ ghi khi tồn hiện tại đúng bằng giá trị này (kiểm kê). */
  expectedStock?: number;
}

/** Danh mục / thương hiệu kèm số sản phẩm (bộ lọc trang danh sách). */
export interface CatalogFacet {
  id: number;
  name: string;
  slug: string;
  productCount: number;
}

const facetSelect = {
  id: true,
  name: true,
  slug: true,
  _count: { select: { products: true } },
} as const;

// Collation của DB (thứ tự byte) đẩy "Âm thanh", "Điện thoại" xuống cuối; sắp theo tiếng Việt.
const vietnameseCollator = new Intl.Collator('vi', { sensitivity: 'base' });

function byVietnameseName(a: CatalogFacet, b: CatalogFacet): number {
  return vietnameseCollator.compare(a.name, b.name) || a.id - b.id;
}

function toFacet(row: {
  id: number;
  name: string;
  slug: string;
  _count: { products: number };
}): CatalogFacet {
  return { id: row.id, name: row.name, slug: row.slug, productCount: row._count.products };
}

export type ApplyPatchResult =
  | { status: 'updated'; sku: string; before: ProductValues; after: ProductValues }
  | { status: 'not_found' }
  | { status: 'insufficient_stock'; available: number }
  | { status: 'stock_changed'; current: number }
  | { status: 'invalid_compare_at_price'; price: number };

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
        select: productCatalogSelect,
        orderBy: buildProductOrderBy(sort),
        skip,
        take,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items: await this.withSales(items), total };
  }

  /**
   * Gắn số đã bán và ẩn giá gốc không hợp lệ (giá bán đã tăng vượt giá gốc).
   * Tính từ order_items, chỉ cho các sản phẩm đang đọc; kết quả đi qua cache catalog nên có thể
   * trễ tối đa bằng TTL – chỉ để hiển thị, không dùng cho nghiệp vụ.
   */
  private async withSales<T extends { id: number; price: number; compareAtPrice: number | null }>(
    products: T[],
  ): Promise<Array<T & SalesInfo>> {
    if (products.length === 0) return [];
    const groups = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        productId: { in: products.map((p) => p.id) },
        order: { status: { not: OrderStatus.CANCELLED } },
      },
      _sum: { quantity: true },
    });
    const sold = new Map(groups.map((g) => [g.productId, g._sum.quantity ?? 0]));
    return products.map((product) => ({
      ...product,
      compareAtPrice:
        product.compareAtPrice !== null && product.compareAtPrice > product.price
          ? product.compareAtPrice
          : null,
      soldCount: sold.get(product.id) ?? 0,
    }));
  }

  async listCategories(): Promise<CatalogFacet[]> {
    const rows = await this.prisma.category.findMany({
      select: facetSelect,
    });
    return rows.map(toFacet).sort(byVietnameseName);
  }

  async listBrands(): Promise<CatalogFacet[]> {
    const rows = await this.prisma.brand.findMany({
      select: facetSelect,
    });
    return rows.map(toFacet).sort(byVietnameseName);
  }

  async findById(id: number): Promise<ProductDetail | null> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: productDetailSelect,
    });
    if (!product) return null;
    const [withSales] = await this.withSales([product]);
    return withSales!;
  }

  /** Tồn kho cho nhân viên – đọc thẳng DB, không qua cache. */
  async findInventoryPage(
    filter: InventoryFilter,
    sort: InventorySort,
    skip: number,
    take: number,
  ): Promise<{ items: InventoryItem[]; total: number }> {
    const where: Prisma.ProductWhereInput = {
      ...(filter.categoryId && { categoryId: filter.categoryId }),
      ...(filter.stockLevel && { stock: stockWhere(filter.stockLevel, filter.threshold) }),
      ...(filter.q && {
        OR: [
          { sku: { contains: filter.q, mode: 'insensitive' } },
          { name: { contains: filter.q, mode: 'insensitive' } },
        ],
      }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        select: inventorySelect,
        orderBy: INVENTORY_ORDER[sort],
        skip,
        take,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items, total };
  }

  /** Số liệu toàn kho trong MỘT câu SQL. Giá trị tồn tính bằng bigint để không tràn int. */
  async inventorySummary(threshold: number): Promise<InventorySummary> {
    const [row] = await this.prisma.$queryRaw<
      Array<{ total: bigint; low: bigint; out: bigint; value: bigint | null }>
    >`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE stock > 0 AND stock < ${threshold}) AS low,
             COUNT(*) FILTER (WHERE stock = 0) AS out,
             SUM(price::bigint * stock) AS value
      FROM products`;
    return {
      totalSkus: Number(row?.total ?? 0),
      lowStock: Number(row?.low ?? 0),
      outOfStock: Number(row?.out ?? 0),
      stockValue: Number(row?.value ?? 0),
    };
  }

  findStockBySku(sku: string): Promise<ProductStock | null> {
    return this.prisma.product.findUnique({
      where: { sku },
      select: { id: true, sku: true, name: true, stock: true },
    });
  }

  /**
   * Áp thay đổi bằng MỘT câu UPDATE nguyên tử, trả cả giá trị trước và sau.
   * - Subquery `FOR UPDATE` khoá dòng và đọc phiên bản mới nhất → request song song xếp hàng,
   *   không ghi đè lên nhau (không lost update).
   * - Điều kiện `stock + delta >= 0` nằm trong WHERE → không bao giờ trừ quá tồn kho.
   * - `expectedStock` cũng nằm trong WHERE → kiểm kê không đè số vừa bị đơn trừ song song.
   * - Giá gốc mới so với giá sẽ có sau câu UPDATE, cũng trong WHERE.
   * Không dùng interactive transaction (SELECT rồi UPDATE qua nhiều round-trip): dưới tải
   * tranh chấp nó giữ connection trong lúc chờ khoá và làm cạn pool (Prisma P2028).
   */
  async applyPatch(id: number, patch: ProductPatch): Promise<ApplyPatchResult> {
    const price = patch.price ?? null;
    const stock = patch.stock ?? null;
    const delta = patch.stockDelta ?? null;
    const expected = patch.expectedStock ?? null;
    // null là giá trị hợp lệ (xoá) nên cần cờ riêng để phân biệt với "không gửi".
    const setImage = patch.imageUrl !== undefined;
    const image = patch.imageUrl ?? null;
    const setCompareAt = patch.compareAtPrice !== undefined;
    const compareAt = patch.compareAtPrice ?? null;

    const [row] = await this.prisma.$queryRaw<
      Array<
        {
          sku: string;
          beforePrice: number;
          beforeStock: number;
          beforeImageUrl: string | null;
          beforeCompareAtPrice: number | null;
        } & ProductValues
      >
    >`
      UPDATE products AS p
      SET price = COALESCE(${price}::int, p.price),
          stock = COALESCE(${stock}::int, p.stock + COALESCE(${delta}::int, 0)),
          image_url = CASE WHEN ${setImage}::boolean THEN ${image}::text ELSE p.image_url END,
          compare_at_price = CASE WHEN ${setCompareAt}::boolean
                                  THEN ${compareAt}::int ELSE p.compare_at_price END,
          updated_at = now()
      FROM (
        SELECT id, price, stock, image_url, compare_at_price
        FROM products WHERE id = ${id} FOR UPDATE
      ) AS old
      WHERE p.id = old.id
        AND old.stock + COALESCE(${delta}::int, 0) >= 0
        AND (${expected}::int IS NULL OR old.stock = ${expected}::int)
        AND (${compareAt}::int IS NULL OR ${compareAt}::int > COALESCE(${price}::int, old.price))
      RETURNING p.sku, old.price AS "beforePrice", old.stock AS "beforeStock",
                old.image_url AS "beforeImageUrl",
                old.compare_at_price AS "beforeCompareAtPrice",
                p.price, p.stock, p.image_url AS "imageUrl",
                p.compare_at_price AS "compareAtPrice"`;

    if (row) {
      return {
        status: 'updated',
        sku: row.sku,
        before: {
          price: row.beforePrice,
          stock: row.beforeStock,
          imageUrl: row.beforeImageUrl,
          compareAtPrice: row.beforeCompareAtPrice,
        },
        after: {
          price: row.price,
          stock: row.stock,
          imageUrl: row.imageUrl,
          compareAtPrice: row.compareAtPrice,
        },
      };
    }

    // Không cập nhật được dòng nào: không tồn tại, tồn đã đổi so với lúc kiểm kê, giá gốc không
    // lớn hơn giá bán, hoặc không đủ hàng.
    const current = await this.prisma.product.findUnique({
      where: { id },
      select: { stock: true, price: true },
    });
    if (!current) return { status: 'not_found' };
    if (expected !== null && current.stock !== expected) {
      return { status: 'stock_changed', current: current.stock };
    }
    const nextPrice = price ?? current.price;
    return compareAt !== null && compareAt <= nextPrice
      ? { status: 'invalid_compare_at_price', price: nextPrice }
      : { status: 'insufficient_stock', available: current.stock };
  }
}
