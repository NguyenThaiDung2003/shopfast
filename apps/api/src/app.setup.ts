import { HttpStatus, INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Express } from 'express';
import { AppException } from './common/exceptions/app.exception';
import type { EnvironmentVariables } from './config/env.validation';
import { HEALTH_PATHS } from './modules/health/health.controller';
import { setupBullBoard } from './modules/jobs/bull-board';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter';

export function validationExceptionFactory(errors: ValidationError[]): AppException {
  const fields = errors.map((e) => e.property).join(', ');
  return new AppException(
    HttpStatus.BAD_REQUEST,
    'VALIDATION_FAILED',
    `Tham số không hợp lệ: ${fields}.`,
  );
}

/**
 * Chuỗi TRUST_PROXY → giá trị `trust proxy` của Express. Số hop (ví dụ 1 = chỉ tin Nginx)
 * khiến `req.ip` lấy phần tử thứ N tính từ phải của X-Forwarded-For, nên client tự chèn
 * X-Forwarded-For giả ở bên trái không đổi được IP (ADR-0008).
 */
export function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

// Cấu hình dùng chung cho main.ts và e2e test để môi trường test giống thật.
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService<EnvironmentVariables, true>);
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set('trust proxy', parseTrustProxy(config.get('TRUST_PROXY', { infer: true })));
  // /health, /health/live ngoài /api: endpoint cho hạ tầng (Docker, load balancer) – ADR-0012.
  app.setGlobalPrefix('api', { exclude: HEALTH_PATHS });
  // Đường dẫn cũ (deprecated): chuyển hướng để không vỡ nơi đang gọi.
  express.get('/api/health', (_req, res) => res.redirect(308, '/health'));
  // Ngoài prefix /api, tự kiểm quyền ADMIN (ADR-0009).
  setupBullBoard(app);
  // Socket.IO tại /socket.io (ngoài /api), đồng bộ room giữa các instance qua Redis (ADR-0010).
  app.useWebSocketAdapter(new RedisIoAdapter(app));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  app.enableShutdownHooks();
}
