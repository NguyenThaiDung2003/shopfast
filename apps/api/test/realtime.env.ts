// Import ĐẦU TIÊN trong realtime.e2e-spec.ts (ConfigModule đọc env ngay khi AppModule được import).
// Suite này đặt nhiều đơn → mỗi đơn phát product.updated → tăng version cache danh sách DÙNG CHUNG
// trên Redis test, làm test đếm truy vấn của catalog-cache (chạy song song) sai ngẫu nhiên.
// Realtime không cần cache: tắt thì CacheService bỏ qua cả invalidation.
process.env.CACHE_ENABLED = 'false';
