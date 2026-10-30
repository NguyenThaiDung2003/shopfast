import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './database/prisma.module';
import { RedisModule } from './database/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { OrdersModule } from './modules/orders/orders.module';
import { RateLimitModule } from './modules/rate-limit/rate-limit.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { CartModule } from './modules/cart/cart.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Chạy từ apps/api vẫn đọc được .env ở gốc repo; trong container biến đến từ compose.
      envFilePath: ['.env', '../../.env'],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    // Domain event nội bộ (ADR-0004).
    EventEmitterModule.forRoot(),
    PrismaModule,
    RedisModule,
    AuthModule,
    // Sau AuthModule: guard rate limit cần request.user của JwtAuthGuard (ADR-0008).
    RateLimitModule,
    UsersModule,
    HealthModule,
    CatalogModule,
    CartModule,
    OrdersModule,
    JobsModule,
    RealtimeModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class AppModule {}
