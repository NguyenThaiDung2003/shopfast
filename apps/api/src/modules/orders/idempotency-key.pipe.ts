import {
  createParamDecorator,
  ExecutionContext,
  HttpStatus,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppException } from '../../common/exceptions/app.exception';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

/** Giá trị header Idempotency-Key (undefined nếu không gửi). Dùng: @IdempotencyKey(IdempotencyKeyPipe). */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined =>
    ctx.switchToHttp().getRequest<Request>().header('idempotency-key'),
);

/** Header Idempotency-Key tuỳ chọn; client nên sinh UUID mới cho mỗi lần bấm "Đặt hàng". */
@Injectable()
export class IdempotencyKeyPipe implements PipeTransform<string | undefined, string | undefined> {
  transform(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'INVALID_IDEMPOTENCY_KEY',
        'Idempotency-Key không hợp lệ: cần 8–100 ký tự gồm chữ, số, "-" hoặc "_".',
      );
    }
    return value;
  }
}
