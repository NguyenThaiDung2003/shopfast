import type { AuthUser } from '../../auth/auth.types';

/** Tên event: <aggregate>.<động từ quá khứ>. Nghe bằng @OnEvent(PRODUCT_UPDATED). */
export const PRODUCT_UPDATED = 'product.updated';

export interface FieldChange<T> {
  from: T;
  to: T;
}

export interface ProductChangeSet {
  price?: FieldChange<number>;
  stock?: FieldChange<number>;
  imageUrl?: FieldChange<string | null>;
  compareAtPrice?: FieldChange<number | null>;
}

/**
 * Phát SAU KHI transaction đã commit, chỉ khi có trường thực sự thay đổi.
 * Listener dự kiến: làm mới cache sản phẩm (F04), đẩy realtime (F02).
 */
export class ProductUpdatedEvent {
  constructor(
    readonly productId: number,
    readonly sku: string,
    readonly changes: ProductChangeSet,
    readonly updatedBy: AuthUser,
    readonly occurredAt: Date = new Date(),
  ) {}
}
