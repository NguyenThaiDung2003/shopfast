-- Ảnh và giá gốc sản phẩm. Không CHECK compare_at_price > price: PATCH giá có thể vượt giá gốc,
-- API chỉ trả giá gốc khi còn lớn hơn giá bán.
ALTER TABLE "products"
  ADD COLUMN "image_url" TEXT,
  ADD COLUMN "compare_at_price" INTEGER;
