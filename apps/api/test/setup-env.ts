// Giá trị giả chỉ dùng cho e2e test, không phải secret thật.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/shopfast_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_SECRET ??= 'test-only-jwt-secret-not-used-in-production';
