-- Sequence sinh mã đơn SF-000001… (thêm tay). Phải tạo trước khi dùng làm DEFAULT.
CREATE SEQUENCE IF NOT EXISTS "order_code_seq" AS INTEGER START 1;
-- Tiếp nối các mã đã có (dữ liệu seed hoặc đơn tạo trước migration này).
SELECT setval(
  'order_code_seq',
  COALESCE((SELECT MAX(substring("code" FROM 4)::int) FROM "orders" WHERE "code" ~ '^SF-[0-9]+$'), 0) + 1,
  false
);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "idempotency_key" TEXT,
ALTER COLUMN "code" SET DEFAULT ('SF-'::text || lpad((nextval('order_code_seq'::regclass))::text, 6, '0'::text));

-- CreateTable
CREATE TABLE "cart_items" (
    "user_id" UUID NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("user_id","product_id")
);

-- CreateIndex
CREATE INDEX "cart_items_product_id_idx" ON "cart_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_user_id_idempotency_key_key" ON "orders"("user_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Ràng buộc nghiệp vụ (thêm tay): mỗi dòng giỏ 1..99 sản phẩm.
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_quantity_range" CHECK ("quantity" BETWEEN 1 AND 99);
