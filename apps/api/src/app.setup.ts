import { HttpStatus, INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Express } from 'express';
import { AppException } from './common/exceptions/app.exception';
import type { EnvironmentVariables } from './config/env.validation';

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
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  app.enableShutdownHooks();
}
