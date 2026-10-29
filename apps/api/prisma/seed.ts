/**
 * Seed dữ liệu mẫu cho môi trường dev/demo.
 * - Xác định (deterministic): PRNG có seed cố định → chạy lại ra cùng dữ liệu.
 * - Idempotent: TRUNCATE ... RESTART IDENTITY rồi tạo lại, id danh mục/thương hiệu luôn 1..N.
 * - Mật khẩu user mẫu lấy từ SEED_USER_PASSWORD, không hardcode.
 */
import { randomUUID } from 'node:crypto';
import { OrderStatus, Prisma, PrismaClient, Role } from '@prisma/client';
import { hash } from 'bcryptjs';

const PRODUCT_COUNT = 200;
const ORDER_COUNT = 50;
const RANDOM_SEED = 20261029;

const CATEGORIES = [
  { name: 'Điện thoại', slug: 'dien-thoai', code: 'DT' },
  { name: 'Laptop', slug: 'laptop', code: 'LT' },
  { name: 'Phụ kiện', slug: 'phu-kien', code: 'PK' },
  { name: 'Âm thanh', slug: 'am-thanh', code: 'AT' },
  { name: 'Gia dụng', slug: 'gia-dung', code: 'GD' },
] as const;

const BRANDS = [
  'Apple',
  'Samsung',
  'Xiaomi',
  'Oppo',
  'Dell',
  'Asus',
  'Lenovo',
  'Anker',
  'Logitech',
  'Philips',
] as const;

type CategoryCode = (typeof CATEGORIES)[number]['code'];
type BrandName = (typeof BRANDS)[number];

interface CategoryProfile {
  brands: BrandName[];
  nouns: string[];
  minPrice: number;
  maxPrice: number;
}

// Giá theo đồng (VND).
const PROFILES: Record<CategoryCode, CategoryProfile> = {
  DT: {
    brands: ['Apple', 'Samsung', 'Xiaomi', 'Oppo'],
    nouns: ['Điện thoại'],
    minPrice: 2_000_000,
    maxPrice: 35_000_000,
  },
  LT: {
    brands: ['Apple', 'Dell', 'Asus', 'Lenovo'],
    nouns: ['Laptop'],
    minPrice: 10_000_000,
    maxPrice: 50_000_000,
  },
  PK: {
    brands: ['Anker', 'Logitech', 'Samsung', 'Xiaomi'],
    nouns: ['Sạc nhanh', 'Cáp USB-C', 'Chuột không dây', 'Bàn phím', 'Pin dự phòng'],
    minPrice: 100_000,
    maxPrice: 2_500_000,
  },
  AT: {
    brands: ['Apple', 'Samsung', 'Anker', 'Philips'],
    nouns: ['Tai nghe', 'Loa bluetooth'],
    minPrice: 300_000,
    maxPrice: 8_000_000,
  },
  GD: {
    brands: ['Philips', 'Xiaomi'],
    nouns: ['Nồi chiên không dầu', 'Máy lọc không khí', 'Robot hút bụi', 'Ấm siêu tốc'],
    minPrice: 300_000,
    maxPrice: 12_000_000,
  },
};

const SERIES = ['Pro', 'Plus', 'Lite', 'Max', 'Air', 'S', 'X', 'Neo'];
const LAST_NAMES = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Ngô'];
const FIRST_NAMES = ['An', 'Bình', 'Chi', 'Dũng', 'Giang', 'Hà', 'Khoa', 'Linh', 'Minh', 'Nam'];

// Mỗi trạng thái đều có đơn; PENDING_PAYMENT nhiều hơn để demo tác vụ nhắc thanh toán (F05).
const ORDER_STATUS_POOL: OrderStatus[] = [
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.PAID,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
];

const STAFF: Array<{ role: Role; count: number }> = [
  { role: Role.ADMIN, count: 1 },
  { role: Role.SUPPORT, count: 2 },
  { role: Role.WAREHOUSE, count: 2 },
  { role: Role.CUSTOMER, count: 20 },
];

/** PRNG mulberry32: nhỏ, nhanh, đủ cho dữ liệu mẫu (không dùng cho mục đích bảo mật). */
function createRandom(seed: number) {
  let state = seed;
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => Math.floor(next() * (max - min + 1)) + min;
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T;
  return { next, int, pick };
}

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Làm tròn kiểu giá bán lẻ: 12.490.000đ, 239.000đ. */
function toRetailPrice(value: number): number {
  const step = value >= 1_000_000 ? 100_000 : 10_000;
  return Math.max(1, Math.round(value / step)) * step - step / 10;
}

function assertSafeEnvironment(): string {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Không được chạy seed trên môi trường production.');
  }
  const password = process.env.SEED_USER_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('Cần đặt SEED_USER_PASSWORD (tối thiểu 8 ký tự) trong .env trước khi seed.');
  }
  return password;
}

async function main(): Promise<void> {
  const password = assertSafeEnvironment();
  const random = createRandom(RANDOM_SEED);
  const prisma = new PrismaClient();
  const passwordHash = await hash(password, 10);

  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`TRUNCATE TABLE order_items, orders, products, brands, categories, users RESTART IDENTITY CASCADE`;

        const categories = await tx.category.createManyAndReturn({
          data: CATEGORIES.map(({ name, slug }) => ({ name, slug })),
        });
        const brands = await tx.brand.createManyAndReturn({
          data: BRANDS.map((name) => ({ name, slug: slugify(name) })),
        });
        const brandIdByName = new Map(brands.map((b) => [b.name, b.id]));

        const products: Prisma.ProductCreateManyInput[] = [];
        for (let i = 0; i < PRODUCT_COUNT; i++) {
          const categoryIndex = i % CATEGORIES.length;
          const category = CATEGORIES[categoryIndex]!;
          const profile = PROFILES[category.code];
          const brand = random.pick(profile.brands);
          const sequence = Math.floor(i / CATEGORIES.length) + 1;
          const sku = `SF-${category.code}-${String(sequence).padStart(4, '0')}`;
          const name = `${random.pick(profile.nouns)} ${brand} ${random.pick(SERIES)} ${random.int(1, 20)}`;
          const price = toRetailPrice(
            profile.minPrice + random.next() * (profile.maxPrice - profile.minPrice),
          );
          // ~6% sản phẩm hết hàng để demo kiểm tra tồn kho.
          const stock = random.next() < 0.06 ? 0 : random.int(1, 500);

          products.push({
            sku,
            name,
            slug: `${slugify(name)}-${sku.toLowerCase()}`,
            description: `${name} chính hãng ${brand}, bảo hành 12 tháng.`,
            price,
            stock,
            categoryId: categories[categoryIndex]!.id,
            brandId: brandIdByName.get(brand)!,
          });
        }
        const createdProducts = await tx.product.createManyAndReturn({ data: products });

        const users: Prisma.UserCreateManyInput[] = STAFF.flatMap(({ role, count }) =>
          Array.from({ length: count }, (_, index) => ({
            email: `${role.toLowerCase()}${String(index + 1).padStart(2, '0')}@shopfast.local`,
            fullName: `${random.pick(LAST_NAMES)} ${random.pick(FIRST_NAMES)}`,
            role,
            passwordHash,
          })),
        );
        const createdUsers = await tx.user.createManyAndReturn({ data: users });
        const customers = createdUsers.filter((u) => u.role === Role.CUSTOMER);

        const orders: Prisma.OrderCreateManyInput[] = [];
        const orderItems: Prisma.OrderItemCreateManyInput[] = [];
        const now = Date.now();
        for (let i = 0; i < ORDER_COUNT; i++) {
          const orderId = randomUUID();
          const status =
            i < ORDER_STATUS_POOL.length ? ORDER_STATUS_POOL[i]! : random.pick(ORDER_STATUS_POOL);
          const createdAt = new Date(now - random.int(1, 30 * 24 * 60) * 60_000);
          const itemCount = random.int(1, 4);
          const chosen = new Set<number>();
          let totalAmount = 0;

          while (chosen.size < itemCount) {
            const product = random.pick(createdProducts);
            if (chosen.has(product.id)) continue;
            chosen.add(product.id);
            const quantity = random.int(1, 3);
            totalAmount += quantity * product.price;
            orderItems.push({ orderId, productId: product.id, quantity, unitPrice: product.price });
          }

          const isPaid = status !== OrderStatus.PENDING_PAYMENT && status !== OrderStatus.CANCELLED;
          orders.push({
            id: orderId,
            code: `SF-${String(i + 1).padStart(6, '0')}`,
            userId: random.pick(customers).id,
            status,
            totalAmount,
            createdAt,
            paidAt: isPaid ? new Date(createdAt.getTime() + random.int(1, 30) * 60_000) : null,
          });
        }
        await tx.order.createMany({ data: orders });
        await tx.orderItem.createMany({ data: orderItems });
      },
      { timeout: 60_000 },
    );

    const [categories, brands, products, users, orders, items] = await Promise.all([
      prisma.category.count(),
      prisma.brand.count(),
      prisma.product.count(),
      prisma.user.count(),
      prisma.order.count(),
      prisma.orderItem.count(),
    ]);
    const byStatus = await prisma.order.groupBy({ by: ['status'], _count: true });
    const byRole = await prisma.user.groupBy({ by: ['role'], _count: true });

    console.log('Seed hoàn tất:');
    console.table({ categories, brands, products, users, orders, orderItems: items });
    console.table(Object.fromEntries(byRole.map((r) => [r.role, r._count])));
    console.table(Object.fromEntries(byStatus.map((s) => [s.status, s._count])));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
