-- DropIndex
DROP INDEX "products_brand_id_idx";

-- DropIndex
DROP INDEX "products_category_id_idx";

-- CreateIndex
CREATE INDEX "products_category_id_price_idx" ON "products"("category_id", "price");

-- CreateIndex
CREATE INDEX "products_brand_id_price_idx" ON "products"("brand_id", "price");

-- CreateIndex
CREATE INDEX "products_created_at_id_idx" ON "products"("created_at" DESC, "id");
