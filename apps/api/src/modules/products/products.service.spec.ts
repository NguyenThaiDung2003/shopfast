import { AppException } from '../../common/exceptions/app.exception';
import { ListProductsQuery } from './dto/list-products.query';
import { ProductListItem, ProductsRepository } from './products.repository';
import { ProductsService } from './products.service';

function buildQuery(overrides: Partial<ListProductsQuery> = {}): ListProductsQuery {
  return Object.assign(new ListProductsQuery(), overrides);
}

const sampleProduct: ProductListItem = {
  id: 1,
  sku: 'SF-DT-0001',
  name: 'Điện thoại Samsung Pro 5',
  slug: 'dien-thoai-samsung-pro-5-sf-dt-0001',
  price: 12_490_000,
  stock: 10,
  category: { id: 1, name: 'Điện thoại', slug: 'dien-thoai' },
  brand: { id: 2, name: 'Samsung', slug: 'samsung' },
};

describe('ProductsService', () => {
  let repository: jest.Mocked<Pick<ProductsRepository, 'findPage'>>;
  let service: ProductsService;

  beforeEach(() => {
    repository = { findPage: jest.fn().mockResolvedValue({ items: [sampleProduct], total: 45 }) };
    service = new ProductsService(repository as unknown as ProductsRepository);
  });

  it('dùng page/limit mặc định và tính số trang', async () => {
    const result = await service.list(buildQuery());

    expect(repository.findPage).toHaveBeenCalledWith(expect.any(Object), 0, 20);
    expect(result.meta).toEqual({ page: 1, limit: 20, total: 45, totalPages: 3 });
    expect(result.items).toEqual([sampleProduct]);
  });

  it('chuyển page thành offset và truyền đủ bộ lọc xuống repository', async () => {
    await service.list(
      buildQuery({ page: 3, limit: 10, categoryId: 1, brandId: 2, minPrice: 1000, maxPrice: 5000 }),
    );

    expect(repository.findPage).toHaveBeenCalledWith(
      { categoryId: 1, brandId: 2, minPrice: 1000, maxPrice: 5000 },
      20,
      10,
    );
  });

  it('trả totalPages = 0 khi không có sản phẩm', async () => {
    repository.findPage.mockResolvedValue({ items: [], total: 0 });

    const result = await service.list(buildQuery());

    expect(result.meta.totalPages).toBe(0);
  });

  it('chấp nhận minPrice bằng maxPrice', async () => {
    await expect(
      service.list(buildQuery({ minPrice: 5000, maxPrice: 5000 })),
    ).resolves.toBeDefined();
  });

  it('từ chối khoảng giá ngược với thông điệp tiếng Việt', async () => {
    const promise = service.list(buildQuery({ minPrice: 9000, maxPrice: 1000 }));

    await expect(promise).rejects.toBeInstanceOf(AppException);
    await expect(promise).rejects.toMatchObject({ code: 'INVALID_PRICE_RANGE' });
    expect(repository.findPage).not.toHaveBeenCalled();
  });
});
