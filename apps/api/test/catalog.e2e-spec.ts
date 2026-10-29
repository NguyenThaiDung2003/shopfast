import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import {
  PRODUCT_UPDATED,
  ProductUpdatedEvent,
} from '../src/modules/catalog/events/product-updated.event';
import { createTestApp } from './create-test-app';

const PASSWORD = 'MatKhau123';
const PRODUCT_COUNT = 24;

interface ListBody {
  items: Array<{ id: number; price: number; category: { id: number }; brand: { id: number } }>;
  meta: { page: number; limit: number; total: number; totalPages: number };
}

describe('Catalog (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const events: ProductUpdatedEvent[] = [];
  const ids = { catA: 0, catB: 0, brandX: 0, brandY: 0 };
  const productIds: number[] = [];
  const tokens = { admin: '', warehouse: '', customer: '' };

  const list = (qs: string) => http.get(`/api/products?${qs}`);
  const patch = (id: number, body: object, token?: string) => {
    const req = http.patch(`/api/products/${id}`).send(body);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  beforeAll(async () => {
    ({ app } = await createTestApp());
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    app.get(EventEmitter2).on(PRODUCT_UPDATED, (e: ProductUpdatedEvent) => events.push(e));

    // Fixture riêng (slug/sku/email có hậu tố e2e) để không đụng test khác chạy song song.
    const [catA, catB] = await prisma.category.createManyAndReturn({
      data: [
        { name: 'E2E A', slug: 'e2e-cat-a' },
        { name: 'E2E B', slug: 'e2e-cat-b' },
      ],
    });
    const [brandX, brandY] = await prisma.brand.createManyAndReturn({
      data: [
        { name: 'E2E X', slug: 'e2e-brand-x' },
        { name: 'E2E Y', slug: 'e2e-brand-y' },
      ],
    });
    Object.assign(ids, { catA: catA!.id, catB: catB!.id, brandX: brandX!.id, brandY: brandY!.id });

    // Sản phẩm i (1..24): chẵn → danh mục A, lẻ → B; chia hết cho 3 → thương hiệu Y; giá i × 100.000đ.
    const products = await prisma.product.createManyAndReturn({
      data: Array.from({ length: PRODUCT_COUNT }, (_, idx) => {
        const i = idx + 1;
        return {
          sku: `E2E-${String(i).padStart(3, '0')}`,
          name: `San pham E2E ${i}`,
          slug: `san-pham-e2e-${i}`,
          description: `Mô tả ${i}`,
          price: i * 100_000,
          stock: 10,
          categoryId: i % 2 === 0 ? ids.catA : ids.catB,
          brandId: i % 3 === 0 ? ids.brandY : ids.brandX,
        };
      }),
    });
    productIds.push(...products.sort((a, b) => a.price - b.price).map((p) => p.id));

    const passwordHash = await hash(PASSWORD, 4);
    for (const role of [Role.ADMIN, Role.WAREHOUSE, Role.CUSTOMER]) {
      const email = `${role.toLowerCase()}.catalog.e2e@shopfast.local`;
      await prisma.user.create({ data: { email, role, passwordHash, fullName: `E2E ${role}` } });
      const res = await http
        .post('/api/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      tokens[role.toLowerCase() as keyof typeof tokens] = res.body.accessToken;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  /** Id sản phẩm thứ i (1..24) trong fixture. */
  const productId = (i: number) => productIds[i - 1]!;

  describe('GET /products – lọc', () => {
    it('theo danh mục: chỉ trả sản phẩm của danh mục đó', async () => {
      const { body } = await list(`categoryId=${ids.catA}&limit=100`).expect(200);
      const res = body as ListBody;

      expect(res.meta.total).toBe(12);
      expect(res.items.every((p) => p.category.id === ids.catA)).toBe(true);
    });

    it('danh mục + thương hiệu', async () => {
      const { body } = await list(`categoryId=${ids.catA}&brandId=${ids.brandY}`).expect(200);

      // i chẵn và chia hết cho 3: 6, 12, 18, 24
      expect((body as ListBody).items.map((p) => p.price).sort((a, b) => a - b)).toEqual([
        600_000, 1_200_000, 1_800_000, 2_400_000,
      ]);
    });

    it('khoảng giá (bao gồm hai đầu)', async () => {
      const { body } = await list(
        `categoryId=${ids.catA}&minPrice=500000&maxPrice=1400000&sort=price_asc`,
      ).expect(200);

      expect((body as ListBody).items.map((p) => p.price)).toEqual([
        600_000, 800_000, 1_000_000, 1_200_000, 1_400_000,
      ]);
    });

    it('chỉ minPrice', async () => {
      const { body } = await list(`brandId=${ids.brandX}&minPrice=2200000`).expect(200);

      // thương hiệu X (không chia hết cho 3) và giá ≥ 2,2tr: 22, 23
      expect((body as ListBody).meta.total).toBe(2);
    });

    it('khoảng giá ngược → 400 INVALID_PRICE_RANGE', async () => {
      const { body } = await list('minPrice=900&maxPrice=100').expect(400);

      expect(body.code).toBe('INVALID_PRICE_RANGE');
    });
  });

  describe('GET /products – sắp xếp và phân trang', () => {
    it('price_asc / price_desc đúng thứ tự', async () => {
      const asc = ((await list(`categoryId=${ids.catB}&sort=price_asc`)).body as ListBody).items;
      const desc = ((await list(`categoryId=${ids.catB}&sort=price_desc`)).body as ListBody).items;

      const ascPrices = asc.map((p) => p.price);
      expect(ascPrices).toEqual([...ascPrices].sort((a, b) => a - b));
      expect(desc.map((p) => p.price)).toEqual([...ascPrices].reverse());
    });

    it('các trang nối lại đủ tập, không trùng không sót', async () => {
      const pages = await Promise.all(
        [1, 2, 3].map(async (page) => {
          const res = await list(`categoryId=${ids.catA}&sort=price_asc&limit=5&page=${page}`);
          return res.body as ListBody;
        }),
      );

      expect(pages.map((p) => p.items.length)).toEqual([5, 5, 2]);
      expect(pages[0]!.meta).toEqual({ page: 1, limit: 5, total: 12, totalPages: 3 });
      const seen = pages.flatMap((p) => p.items.map((i) => i.id));
      expect(new Set(seen).size).toBe(12);
    });

    it('trang vượt quá tổng → items rỗng', async () => {
      const { body } = await list(`categoryId=${ids.catA}&limit=5&page=4`).expect(200);

      expect((body as ListBody).items).toEqual([]);
      expect((body as ListBody).meta.total).toBe(12);
    });

    it.each([
      ['limit=101', 'limit vượt tối đa 100'],
      ['limit=0', 'limit = 0'],
      ['page=0', 'page = 0'],
      ['page=1001', 'page vượt tối đa'],
      ['sort=gia_re', 'sort không hợp lệ'],
      ['categoryId=abc', 'categoryId không phải số'],
      ['minPrice=-1', 'giá âm'],
    ])('400 VALIDATION_FAILED: %s (%s)', async (qs) => {
      const { body } = await list(qs).expect(400);

      expect(body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('GET /products/:id', () => {
    it('200: trả chi tiết có description', async () => {
      const { body } = await http.get(`/api/products/${productId(1)}`).expect(200);

      expect(body).toMatchObject({ id: productId(1), sku: 'E2E-001', description: 'Mô tả 1' });
    });

    it('404: không tồn tại', async () => {
      const { body } = await http.get('/api/products/2000000000').expect(404);

      expect(body).toMatchObject({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Không tìm thấy sản phẩm.',
      });
    });

    it.each(['abc', '-1', '0', '99999999999'])('400 INVALID_ID: %s', async (id) => {
      const { body } = await http.get(`/api/products/${id}`).expect(400);

      expect(body.code).toBe('INVALID_ID');
    });
  });

  describe('PATCH /products/:id', () => {
    beforeEach(() => {
      events.length = 0;
    });

    it('401: chưa đăng nhập', async () => {
      await patch(productId(2), { stockDelta: 1 }).expect(401);
    });

    it('403 FORBIDDEN_ROLE: customer', async () => {
      const { body } = await patch(productId(2), { stockDelta: 1 }, tokens.customer).expect(403);

      expect(body.code).toBe('FORBIDDEN_ROLE');
    });

    it('warehouse nhập kho bằng stockDelta → 200 và phát product.updated', async () => {
      const { body } = await patch(productId(2), { stockDelta: 5 }, tokens.warehouse).expect(200);

      expect(body.stock).toBe(15);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        productId: productId(2),
        sku: 'E2E-002',
        changes: { stock: { from: 10, to: 15 } },
        updatedBy: { role: Role.WAREHOUSE },
      });
    });

    it('403 FORBIDDEN_FIELD: warehouse không được sửa giá', async () => {
      const { body } = await patch(productId(3), { price: 1 }, tokens.warehouse).expect(403);

      expect(body.code).toBe('FORBIDDEN_FIELD');
      expect(events).toHaveLength(0);
    });

    it('admin sửa giá → GET thấy giá mới, event có giá cũ/mới', async () => {
      await patch(productId(4), { price: 399_000 }, tokens.admin).expect(200);

      const { body } = await http.get(`/api/products/${productId(4)}`).expect(200);
      expect(body.price).toBe(399_000);
      expect(events[0]!.changes).toEqual({ price: { from: 400_000, to: 399_000 } });
    });

    it('409 INSUFFICIENT_STOCK: trừ quá tồn kho, tồn kho không đổi, không phát event', async () => {
      const { body } = await patch(productId(5), { stockDelta: -11 }, tokens.warehouse).expect(409);

      expect(body.code).toBe('INSUFFICIENT_STOCK');
      const product = await http.get(`/api/products/${productId(5)}`);
      expect(product.body.stock).toBe(10);
      expect(events).toHaveLength(0);
    });

    it('400: body rỗng / gửi cả stock và stockDelta / trường lạ bị bỏ qua', async () => {
      const empty = await patch(productId(6), {}, tokens.admin).expect(400);
      const conflict = await patch(productId(6), { stock: 1, stockDelta: 1 }, tokens.admin).expect(
        400,
      );
      const unknownOnly = await patch(productId(6), { name: 'Hack' }, tokens.admin).expect(400);

      expect(empty.body.code).toBe('EMPTY_UPDATE');
      expect(conflict.body.code).toBe('STOCK_CONFLICT');
      expect(unknownOnly.body.code).toBe('EMPTY_UPDATE');
    });

    it('404: sản phẩm không tồn tại', async () => {
      await patch(2_000_000_000, { stock: 1 }, tokens.admin).expect(404);
    });

    it('12 request trừ kho đồng thời trên tồn kho 10 → đúng 10 thành công, tồn kho về 0', async () => {
      const results = await Promise.all(
        Array.from({ length: 12 }, () => patch(productId(7), { stockDelta: -1 }, tokens.warehouse)),
      );

      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 200)).toHaveLength(10);
      expect(statuses.filter((s) => s === 409)).toHaveLength(2);
      const product = await http.get(`/api/products/${productId(7)}`);
      expect(product.body.stock).toBe(0);
      expect(events).toHaveLength(10);
    });
  });
});
