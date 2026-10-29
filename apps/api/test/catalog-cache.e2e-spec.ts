import { AddressInfo, createServer, Server, Socket } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import Redis from 'ioredis';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import { REDIS_CLIENT } from '../src/database/redis.constants';
import { CatalogRepository } from '../src/modules/catalog/catalog.repository';
import { createTestApp } from './create-test-app';

const PASSWORD = 'MatKhau123';

interface ProductBody {
  id: number;
  price: number;
  stock: number;
}

interface StatsBody {
  namespaces: Array<{ name: string; hits: number; misses: number; hitRate: number }>;
  total: { hits: number; misses: number; hitRate: number };
}

/** Client trỏ vào Redis không dùng được; cùng tuỳ chọn fail-fast như RedisModule. */
function brokenRedis(url: string): Redis {
  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 100,
    connectTimeout: 200,
    retryStrategy: () => null,
  });
  client.on('error', () => undefined);
  client.connect().catch(() => undefined);
  return client;
}

describe('Catalog cache (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let repository: CatalogRepository;
  let categoryId = 0;
  let brandId = 0;
  const tokens = { admin: '', customer: '' };
  let seq = 0;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const getProduct = (id: number) => http.get(`/api/products/${id}`);
  const listMine = (qs = '') => http.get(`/api/products?categoryId=${categoryId}${qs}`);
  const stats = async () =>
    (await http.get('/api/admin/cache/stats').set(auth(tokens.admin)).expect(200))
      .body as StatsBody;
  const nsHits = (body: StatsBody, name: string) =>
    body.namespaces.find((n) => n.name === name)?.hits ?? 0;

  /** Mỗi test một sản phẩm mới → key nguội, không phụ thuộc thứ tự test. */
  async function newProduct(price = 1_000_000, stock = 10): Promise<number> {
    seq += 1;
    const sku = `CACHE-${seq}`;
    const product = await prisma.product.create({
      data: {
        sku,
        name: `Cache ${seq}`,
        slug: sku.toLowerCase(),
        price,
        stock,
        categoryId,
        brandId,
      },
    });
    return product.id;
  }

  async function login(email: string, role: Role, passwordHash: string): Promise<string> {
    await prisma.user.create({ data: { email, role, passwordHash, fullName: `E2E ${role}` } });
    const res = await http.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return res.body.accessToken as string;
  }

  beforeAll(async () => {
    ({ app } = await createTestApp());
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    repository = app.get(CatalogRepository);

    categoryId = (await prisma.category.create({ data: { name: 'E2E Cache', slug: 'e2e-cache' } }))
      .id;
    brandId = (await prisma.brand.create({ data: { name: 'E2E Cache', slug: 'e2e-cache' } })).id;
    const passwordHash = await hash(PASSWORD, 4);
    tokens.admin = await login('admin.cache.e2e@shopfast.local', Role.ADMIN, passwordHash);
    tokens.customer = await login('customer.cache.e2e@shopfast.local', Role.CUSTOMER, passwordHash);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('cache-aside', () => {
    it('GET chi tiết lần 2 trúng cache: không truy vấn DB, thống kê tăng hit', async () => {
      const id = await newProduct();
      const findById = jest.spyOn(repository, 'findById');
      const before = nsHits(await stats(), 'product');

      const first = await getProduct(id).expect(200);
      const second = await getProduct(id).expect(200);

      expect(second.body).toEqual(first.body);
      expect(findById).toHaveBeenCalledTimes(1);
      expect(nsHits(await stats(), 'product')).toBeGreaterThan(before);
    });

    it('GET danh sách cùng bộ lọc (khác thứ tự tham số) → 1 lần truy vấn DB', async () => {
      await newProduct();
      const findPage = jest.spyOn(repository, 'findPage');

      await http.get(`/api/products?categoryId=${categoryId}&sort=price_asc&limit=50`).expect(200);
      await http.get(`/api/products?limit=50&sort=price_asc&categoryId=${categoryId}`).expect(200);

      expect(findPage).toHaveBeenCalledTimes(1);
    });

    it('id không tồn tại: 404 cả hai lần nhưng chỉ 1 lần truy vấn DB', async () => {
      const findById = jest.spyOn(repository, 'findById');

      const res = await getProduct(987_654).expect(404);
      await getProduct(987_654).expect(404);

      expect(res.body.code).toBe('PRODUCT_NOT_FOUND');
      expect(findById).toHaveBeenCalledTimes(1);
    });

    it('20 request đồng thời vào key nguội → tất cả 200, gần như chỉ 1 lần đọc DB', async () => {
      const id = await newProduct();
      const findById = jest.spyOn(repository, 'findById');

      const responses = await Promise.all(Array.from({ length: 20 }, () => getProduct(id)));

      expect(responses.every((r) => r.status === 200 && r.body.id === id)).toBe(true);
      // Người giữ lock nạp key; người khác chờ ≤ 300ms rồi đọc lại. Cho phép 1 lần dư nếu
      // máy CI quá chậm khiến người chờ hết hạn và tự đọc DB.
      expect(findById.mock.calls.length).toBeLessThanOrEqual(2);
    });
  });

  describe('invalidation – khách không thấy giá cũ', () => {
    it('admin đổi giá → GET chi tiết và danh sách ngay sau đó trả giá mới', async () => {
      const id = await newProduct(2_000_000);
      await getProduct(id).expect(200);
      const cachedList = (await listMine('&limit=100').expect(200)).body.items as ProductBody[];
      expect(cachedList.find((p) => p.id === id)?.price).toBe(2_000_000);

      await http
        .patch(`/api/products/${id}`)
        .set(auth(tokens.admin))
        .send({ price: 1_500_000 })
        .expect(200);

      expect((await getProduct(id).expect(200)).body.price).toBe(1_500_000);
      const list = (await listMine('&limit=100').expect(200)).body.items as ProductBody[];
      expect(list.find((p) => p.id === id)?.price).toBe(1_500_000);
    });

    it('bộ lọc giá: sản phẩm giảm giá xuất hiện ngay trong danh sách "dưới 1tr"', async () => {
      const id = await newProduct(1_200_000);
      const cheap = () => listMine('&maxPrice=1000000&limit=100').expect(200);
      expect(((await cheap()).body.items as ProductBody[]).some((p) => p.id === id)).toBe(false);

      await http
        .patch(`/api/products/${id}`)
        .set(auth(tokens.admin))
        .send({ price: 990_000 })
        .expect(200);

      expect(((await cheap()).body.items as ProductBody[]).some((p) => p.id === id)).toBe(true);
    });

    it('đặt đơn trừ kho → GET chi tiết thấy tồn kho mới', async () => {
      const id = await newProduct(100_000, 10);
      expect((await getProduct(id).expect(200)).body.stock).toBe(10);

      await http
        .post('/api/cart/items')
        .set(auth(tokens.customer))
        .send({ productId: id, quantity: 3 })
        .expect(201);
      await http.post('/api/orders').set(auth(tokens.customer)).expect(201);

      expect((await getProduct(id).expect(200)).body.stock).toBe(7);
    });

    it('chỉ sản phẩm bị đổi mất cache; sản phẩm khác vẫn trúng', async () => {
      const changed = await newProduct();
      const untouched = await newProduct();
      await getProduct(changed).expect(200);
      await getProduct(untouched).expect(200);
      const findById = jest.spyOn(repository, 'findById');

      await http
        .patch(`/api/products/${changed}`)
        .set(auth(tokens.admin))
        .send({ stockDelta: 1 })
        .expect(200);
      await getProduct(untouched).expect(200);

      // findById của PATCH (đọc thẳng DB) – không có lần nào cho sản phẩm không đổi.
      expect(findById.mock.calls.map(([arg]) => arg)).toEqual([changed]);
    });
  });

  describe('GET /admin/cache/stats', () => {
    it('admin xem được tỉ lệ trúng; reset đưa bộ đếm về 0', async () => {
      const body = await stats();
      expect(body.total.hitRate).toBeGreaterThanOrEqual(0);
      expect(body.total.hitRate).toBeLessThanOrEqual(1);
      expect(body.namespaces.map((n) => n.name)).toEqual(
        expect.arrayContaining(['product', 'product_list']),
      );

      await http.delete('/api/admin/cache/stats').set(auth(tokens.admin)).expect(204);
    });

    it('customer → 403, chưa đăng nhập → 401', async () => {
      await http.get('/api/admin/cache/stats').set(auth(tokens.customer)).expect(403);
      await http.get('/api/admin/cache/stats').expect(401);
    });
  });

  describe('Redis bị tắt → API vẫn trả 200 từ DB', () => {
    const blackHoles: Server[] = [];
    const sockets: Socket[] = [];

    afterAll(() => {
      for (const socket of sockets) socket.destroy();
      for (const server of blackHoles) server.close();
    });

    async function blackHoleUrl(): Promise<string> {
      // Nhận kết nối nhưng không bao giờ trả lời – mô phỏng Redis treo.
      const server = createServer((socket) => sockets.push(socket));
      blackHoles.push(server);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      return `redis://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }

    interface Outage {
      /** Thay REDIS_CLIENT trước khi khởi tạo app. */
      client?: () => Promise<Redis>;
      /** Phá Redis sau khi app đã chạy với client thật. */
      afterInit?: (app: INestApplication) => Promise<void>;
    }

    const outages: Array<[string, Outage]> = [
      [
        'mất kết nối giữa chừng',
        {
          afterInit: async (degraded) => {
            const client = degraded.get<Redis>(REDIS_CLIENT);
            if (client.status !== 'ready') await new Promise((r) => client.once('ready', r));
            await request(degraded.getHttpServer()).get('/api/products/1'); // đã dùng được cache
            client.disconnect();
          },
        },
      ],
      ['cổng Redis đóng', { client: async () => brokenRedis('redis://127.0.0.1:1') }],
      ['Redis treo, không trả lời', { client: async () => brokenRedis(await blackHoleUrl()) }],
    ];

    it.each(outages)('%s', async (_name, outage) => {
      const id = await newProduct(3_000_000, 4);
      // App riêng để không làm hỏng Redis của các test khác.
      const replacement = await outage.client?.();
      const { app: degraded } = await createTestApp({
        override: (builder) =>
          replacement ? builder.overrideProvider(REDIS_CLIENT).useValue(replacement) : builder,
      });
      const api = request(degraded.getHttpServer());
      try {
        await outage.afterInit?.(degraded);
        const started = Date.now();

        const detail = await api.get(`/api/products/${id}`).expect(200);
        const list = await api.get(`/api/products?categoryId=${categoryId}&limit=100`).expect(200);
        await api.get('/api/products/987654').expect(404);
        await api
          .patch(`/api/products/${id}`)
          .set(auth(tokens.admin))
          .send({ price: 2_900_000 })
          .expect(200);
        const after = await api.get(`/api/products/${id}`).expect(200);

        expect(detail.body).toMatchObject({ id, price: 3_000_000, stock: 4 });
        expect((list.body.items as ProductBody[]).some((p) => p.id === id)).toBe(true);
        expect(after.body.price).toBe(2_900_000);
        // Không request nào bị treo chờ Redis.
        expect(Date.now() - started).toBeLessThan(3_000);
      } finally {
        await degraded.close();
      }
    });
  });
});
