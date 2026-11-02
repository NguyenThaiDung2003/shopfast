-- User hiện có và user tạo trực tiếp (seed, nhân viên) coi như đã xác minh; chỉ POST /auth/register ghi NULL.
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
