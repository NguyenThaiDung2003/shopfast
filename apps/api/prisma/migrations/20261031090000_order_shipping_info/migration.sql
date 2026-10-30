-- Thông tin nhận hàng của đơn; nullable vì đơn cũ không có.
ALTER TABLE "orders"
  ADD COLUMN "recipient_name" TEXT,
  ADD COLUMN "recipient_phone" TEXT,
  ADD COLUMN "shipping_address" TEXT,
  ADD COLUMN "shipping_note" TEXT;
