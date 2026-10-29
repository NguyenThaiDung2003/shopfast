import { HttpStatus, INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import { AppException } from './common/exceptions/app.exception';

export function validationExceptionFactory(errors: ValidationError[]): AppException {
  const fields = errors.map((e) => e.property).join(', ');
  return new AppException(
    HttpStatus.BAD_REQUEST,
    'VALIDATION_FAILED',
    `Tham số không hợp lệ: ${fields}.`,
  );
}

// Cấu hình dùng chung cho main.ts và e2e test để môi trường test giống thật.
export function configureApp(app: INestApplication): void {
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
