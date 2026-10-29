import { CartLine, CartRepository } from './cart.repository';
import { CartService, toCartView } from './cart.service';

const USER = 'user-1';

function line(productId: number, quantity: number, price: number, stock: number): CartLine {
  return {
    productId,
    quantity,
    product: {
      sku: `SKU-${productId}`,
      name: `Sản phẩm ${productId}`,
      slug: `sp-${productId}`,
      price,
      stock,
    },
  };
}

describe('CartService', () => {
  let repository: jest.Mocked<
    Pick<
      CartRepository,
      'findLines' | 'findQuantity' | 'findProduct' | 'setQuantity' | 'remove' | 'clear'
    >
  >;
  let service: CartService;

  beforeEach(() => {
    repository = {
      findLines: jest.fn().mockResolvedValue([]),
      findQuantity: jest.fn().mockResolvedValue(null),
      findProduct: jest.fn().mockResolvedValue({ name: 'Chuột', stock: 10 }),
      setQuantity: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(true),
      clear: jest.fn().mockResolvedValue(undefined),
    };
    service = new CartService(repository as unknown as CartRepository);
  });

  describe('toCartView', () => {
    it('tính thành tiền, tổng số lượng, tạm tính và cờ thiếu hàng', () => {
      const view = toCartView([line(1, 2, 100_000, 5), line(2, 3, 50_000, 1)]);

      expect(view.totalQuantity).toBe(5);
      expect(view.subtotal).toBe(350_000);
      expect(view.items[0]).toMatchObject({ lineTotal: 200_000, insufficientStock: false });
      expect(view.items[1]).toMatchObject({ available: 1, insufficientStock: true });
    });

    it('giỏ rỗng', () => {
      expect(toCartView([])).toEqual({ items: [], totalQuantity: 0, subtotal: 0 });
    });
  });

  describe('addItem', () => {
    it('sản phẩm mới → lưu đúng số lượng', async () => {
      await service.addItem(USER, { productId: 7, quantity: 2 });

      expect(repository.setQuantity).toHaveBeenCalledWith(USER, 7, 2);
    });

    it('đã có trong giỏ → cộng dồn', async () => {
      repository.findQuantity.mockResolvedValue(3);

      await service.addItem(USER, { productId: 7, quantity: 2 });

      expect(repository.setQuantity).toHaveBeenCalledWith(USER, 7, 5);
    });

    it('cộng dồn vượt 99 → CART_LINE_LIMIT', async () => {
      repository.findQuantity.mockResolvedValue(98);

      await expect(service.addItem(USER, { productId: 7, quantity: 2 })).rejects.toMatchObject({
        code: 'CART_LINE_LIMIT',
      });
      expect(repository.setQuantity).not.toHaveBeenCalled();
    });

    it('sản phẩm không tồn tại → PRODUCT_NOT_FOUND', async () => {
      repository.findProduct.mockResolvedValue(null);

      await expect(service.addItem(USER, { productId: 7, quantity: 1 })).rejects.toMatchObject({
        code: 'PRODUCT_NOT_FOUND',
      });
    });

    it('vượt tồn kho → INSUFFICIENT_STOCK nêu tên và số còn', async () => {
      repository.findProduct.mockResolvedValue({ name: 'Chuột', stock: 2 });

      await expect(service.addItem(USER, { productId: 7, quantity: 3 })).rejects.toMatchObject({
        code: 'INSUFFICIENT_STOCK',
        userMessage: 'Sản phẩm "Chuột" chỉ còn 2, không đủ 3.',
        details: { productId: 7, requested: 3, available: 2 },
      });
    });

    it('hết hàng → thông điệp "đã hết hàng"', async () => {
      repository.findProduct.mockResolvedValue({ name: 'Chuột', stock: 0 });

      await expect(service.addItem(USER, { productId: 7, quantity: 1 })).rejects.toMatchObject({
        userMessage: 'Sản phẩm "Chuột" đã hết hàng.',
      });
    });
  });

  describe('updateItem / removeItem / clear', () => {
    it('sửa số lượng dòng đang có', async () => {
      repository.findQuantity.mockResolvedValue(1);

      await service.updateItem(USER, 7, 4);

      expect(repository.setQuantity).toHaveBeenCalledWith(USER, 7, 4);
    });

    it('sửa dòng không có trong giỏ → CART_ITEM_NOT_FOUND', async () => {
      await expect(service.updateItem(USER, 7, 4)).rejects.toMatchObject({
        code: 'CART_ITEM_NOT_FOUND',
      });
    });

    it('xoá dòng không có → CART_ITEM_NOT_FOUND', async () => {
      repository.remove.mockResolvedValue(false);

      await expect(service.removeItem(USER, 7)).rejects.toMatchObject({
        code: 'CART_ITEM_NOT_FOUND',
      });
    });

    it('xoá dòng và xoá hết giỏ', async () => {
      await service.removeItem(USER, 7);
      await service.clear(USER);

      expect(repository.remove).toHaveBeenCalledWith(USER, 7);
      expect(repository.clear).toHaveBeenCalledWith(USER);
    });
  });
});
