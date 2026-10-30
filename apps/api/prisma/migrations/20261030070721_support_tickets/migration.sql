-- Sequence sinh mã ticket TK-000001… (thêm tay). Phải tạo trước khi dùng làm DEFAULT.
CREATE SEQUENCE IF NOT EXISTS "ticket_code_seq" AS INTEGER START 1;

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('DON_HANG', 'VAN_CHUYEN', 'THANH_TOAN', 'DOI_TRA', 'SAN_PHAM', 'KHAC');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CategorySource" AS ENUM ('LLM', 'FALLBACK', 'STAFF');

-- CreateEnum
CREATE TYPE "PendingActionType" AS ENUM ('CANCEL_ORDER', 'CREATE_RETURN_REQUEST');

-- CreateEnum
CREATE TYPE "PendingActionStatus" AS ENUM ('PENDING', 'EXECUTING', 'EXECUTED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReturnRequestStatus" AS ENUM ('REQUESTED');

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL DEFAULT ('TK-'::text || lpad((nextval('ticket_code_seq'::regclass))::text, 6, '0'::text)),
    "customer_id" UUID NOT NULL,
    "order_id" UUID,
    "subject" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "category" "TicketCategory",
    "category_source" "CategorySource",
    "classified_at" TIMESTAMP(3),
    "idempotency_key" TEXT,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" SERIAL NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_actions" (
    "id" UUID NOT NULL,
    "type" "PendingActionType" NOT NULL,
    "status" "PendingActionStatus" NOT NULL DEFAULT 'PENDING',
    "ticket_id" UUID,
    "order_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "proposed_by_id" UUID NOT NULL,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_requests" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReturnRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "created_by_id" UUID NOT NULL,
    "pending_action_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tickets_code_key" ON "tickets"("code");

-- CreateIndex
CREATE INDEX "tickets_status_last_message_at_idx" ON "tickets"("status", "last_message_at");

-- CreateIndex
CREATE INDEX "tickets_customer_id_created_at_idx" ON "tickets"("customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_customer_id_idempotency_key_key" ON "tickets"("customer_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "ticket_messages_ticket_id_created_at_idx" ON "ticket_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "pending_actions_status_created_at_idx" ON "pending_actions"("status", "created_at");

-- CreateIndex
CREATE INDEX "pending_actions_order_id_idx" ON "pending_actions"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_requests_pending_action_id_key" ON "return_requests"("pending_action_id");

-- CreateIndex
CREATE INDEX "return_requests_order_id_idx" ON "return_requests"("order_id");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_proposed_by_id_fkey" FOREIGN KEY ("proposed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_pending_action_id_fkey" FOREIGN KEY ("pending_action_id") REFERENCES "pending_actions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ───── Ràng buộc nghiệp vụ (thêm tay, ADR-0011) ─────

-- Mỗi đơn tối đa một đề xuất đang chờ/đang chạy cho mỗi loại thao tác:
-- agent gọi tool lặp hoặc hai nhân viên cùng hỏi không tạo đề xuất trùng.
CREATE UNIQUE INDEX "pending_actions_open_per_order_key"
  ON "pending_actions" ("type", "order_id")
  WHERE "status" IN ('PENDING', 'EXECUTING');

-- Mỗi đơn tối đa một yêu cầu đổi trả đang mở.
CREATE UNIQUE INDEX "return_requests_open_per_order_key"
  ON "return_requests" ("order_id")
  WHERE "status" = 'REQUESTED';

-- Đã quyết định thì phải biết ai và lúc nào.
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_decided_check"
  CHECK ("status" IN ('PENDING') OR ("decided_by_id" IS NOT NULL AND "decided_at" IS NOT NULL));

ALTER TABLE "tickets" ADD CONSTRAINT "tickets_subject_length" CHECK (char_length("subject") BETWEEN 1 AND 200);
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_body_length" CHECK (char_length("body") BETWEEN 1 AND 5000);
