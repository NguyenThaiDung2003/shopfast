-- Đổi tên giá trị enum tại chỗ (viết tay). Prisma mặc định tạo lại enum và ép kiểu bằng text,
-- cách đó thất bại với các đơn đang ở 'SHIPPED'. RENAME VALUE giữ nguyên dữ liệu, chạy tức thì.
ALTER TYPE "OrderStatus" RENAME VALUE 'SHIPPED' TO 'SHIPPING';

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" SERIAL NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus" NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ràng buộc nghiệp vụ (thêm tay): một bản ghi lịch sử luôn là một bước chuyển thật.
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_changes_status" CHECK ("from_status" IS NULL OR "from_status" <> "to_status");
