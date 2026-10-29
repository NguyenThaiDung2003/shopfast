// Import ĐẦU TIÊN trong rate-limit.e2e-spec.ts: ConfigModule đọc env ngay khi AppModule được
// import, nên phải hạ hạn mức trước đó. setup-env.ts đặt lại giá trị cao cho các suite khác.
export const LIMITS = { global: 8, login: 3, otpSend: 2, promoOrder: 2 };

process.env.RATE_LIMIT_GLOBAL = `${LIMITS.global}/60`;
process.env.RATE_LIMIT_LOGIN = `${LIMITS.login}/60`;
process.env.RATE_LIMIT_OTP_SEND = `${LIMITS.otpSend}/300`;
process.env.RATE_LIMIT_PROMO_ORDER = `${LIMITS.promoOrder}/60`;
