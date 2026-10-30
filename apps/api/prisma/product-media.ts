/** Dữ liệu mẫu (seed, backfill): ảnh minh hoạ theo danh mục nằm ở apps/web/public/images/products. */
export function sampleImageUrl(categorySlug: string): string {
  return `/images/products/${categorySlug}.svg`;
}

/** Tất định theo id: khoảng 60% sản phẩm có giá gốc cao hơn giá bán 10–40%, làm tròn nghìn. */
export function sampleCompareAtPrice(id: number, price: number): number | null {
  if (id % 5 >= 3) return null;
  const percent = 10 + ((id * 7) % 31);
  return Math.round((price * (100 + percent)) / 100 / 1000) * 1000;
}
