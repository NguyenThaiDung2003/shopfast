import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/errors';
import { useSession } from '../auth/useAuth';
import { useToast } from '../components/ui';
import { addToCart, cartKeys, type Product } from './product-api';

/** Ai đang xem: khách đăng nhập mua được, khách vãng lai được mời đăng nhập, nhân viên không mua. */
export type PurchaseMode = 'customer' | 'guest' | 'staff';

interface AddToCartInput {
  product: Pick<Product, 'id' | 'name'>;
  quantity: number;
}

/**
 * Thêm vào giỏ dùng chung (danh sách, chi tiết…): khách vãng lai → trang đăng nhập kèm `next`,
 * khách hàng → POST /cart/items + toast; lỗi (hết hàng, vượt 99…) hiện thông điệp từ API.
 */
export function useAddToCart() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const purchase: PurchaseMode = !session
    ? 'guest'
    : session.user.role === 'CUSTOMER'
      ? 'customer'
      : 'staff';

  const mutation = useMutation({
    mutationFn: ({ product, quantity }: AddToCartInput) => addToCart(product.id, quantity),
    onSuccess: (_data, { product, quantity }) => {
      toast.success(
        'Đã thêm vào giỏ hàng',
        quantity > 1 ? `${product.name} × ${quantity}` : product.name,
      );
      void queryClient.invalidateQueries({ queryKey: cartKeys.all });
    },
    onError: (error) => toast.error('Không thêm được vào giỏ hàng', errorMessage(error)),
  });

  /** `onAdded` chạy sau khi thêm thành công (ví dụ "Mua ngay" → sang giỏ hàng). */
  const add = (product: AddToCartInput['product'], quantity = 1, onAdded?: () => void) => {
    if (purchase === 'guest') {
      const next = `${location.pathname}${location.search}`;
      navigate(`/dang-nhap?next=${encodeURIComponent(next)}`);
      return;
    }
    if (purchase === 'staff') return;
    mutation.mutate({ product, quantity }, { onSuccess: () => onAdded?.() });
  };

  return {
    purchase,
    add,
    isPending: mutation.isPending,
    /** Sản phẩm đang được thêm (để hiện loading đúng nút). */
    pendingProductId: mutation.isPending ? mutation.variables?.product.id : undefined,
  };
}
