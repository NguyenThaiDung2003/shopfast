import { PrismaClient } from '@prisma/client';
import { clearCatalogCache } from './clear-cache';
import { sampleCompareAtPrice, sampleImageUrl } from './product-media';

/**
 * Điền ảnh minh hoạ và giá gốc mẫu cho sản phẩm có sẵn, không cần seed lại (seed xoá đơn hàng).
 * Chạy lại an toàn: chỉ sửa dòng chưa có ảnh. Sửa bằng SQL nên phải tự xoá cache (ADR-0007).
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const products = await prisma.product.findMany({
      where: { imageUrl: null },
      select: { id: true, price: true, category: { select: { slug: true } } },
    });
    for (const product of products) {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          imageUrl: sampleImageUrl(product.category.slug),
          compareAtPrice: sampleCompareAtPrice(product.id, product.price),
        },
      });
    }
    console.log(`Đã điền ảnh và giá gốc cho ${products.length} sản phẩm.`);
  } finally {
    await prisma.$disconnect();
  }
  await clearCatalogCache(process.env.REDIS_URL);
}

void main();
