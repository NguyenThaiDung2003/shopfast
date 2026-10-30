import type { BadgeTone } from '../components/ui';

/** Từ ngưỡng này trở xuống hiện "Sắp hết (còn N)". */
export const LOW_STOCK_THRESHOLD = 5;

export interface StockStatus {
  label: string;
  tone: BadgeTone;
  inStock: boolean;
}

export function stockStatus(stock: number): StockStatus {
  if (stock <= 0) return { label: 'Tạm hết hàng', tone: 'neutral', inStock: false };
  if (stock <= LOW_STOCK_THRESHOLD) {
    return { label: `Sắp hết (còn ${stock})`, tone: 'warning', inStock: true };
  }
  return { label: 'Còn hàng', tone: 'success', inStock: true };
}

const CATEGORY_ICONS: Record<string, string> = {
  'dien-thoai': 'smartphone',
  laptop: 'laptop_mac',
  'phu-kien': 'cable',
  'am-thanh': 'headphones',
  'gia-dung': 'kitchen',
};

/** Icon thay thế khi sản phẩm chưa có ảnh. */
export function categoryIcon(slug: string): string {
  return CATEGORY_ICONS[slug] ?? 'inventory_2';
}

/** % giảm so với giá gốc; không có giá gốc hợp lệ → null. */
export function discountPercent(price: number, compareAt?: number | null): number | null {
  if (!compareAt || compareAt <= price) return null;
  return Math.round(((compareAt - price) / compareAt) * 100);
}

/** `Đã bán 890`, `Đã bán 1,4k`. */
export function formatSold(count: number): string {
  if (count < 1000) return `Đã bán ${count}`;
  const thousands = Math.round(count / 100) / 10;
  return `Đã bán ${thousands.toLocaleString('vi-VN')}k`;
}
