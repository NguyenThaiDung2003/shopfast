import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/** Bỏ qua JwtAuthGuard toàn cục. Mặc định mọi endpoint đều yêu cầu đăng nhập. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
