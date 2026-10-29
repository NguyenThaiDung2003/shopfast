import { HttpStatus, Injectable, PipeTransform } from '@nestjs/common';
import { AppException } from '../exceptions/app.exception';

const MAX_INT32 = 2_147_483_647;

/**
 * Id số nguyên dương trên URL. Chặn cả số âm và số vượt INTEGER của PostgreSQL
 * (ParseIntPipe mặc định cho qua, Prisma sẽ lỗi 500).
 */
@Injectable()
export class ParseIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const id = /^\d{1,10}$/.test(value) ? Number(value) : NaN;
    if (!Number.isInteger(id) || id < 1 || id > MAX_INT32) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'INVALID_ID', 'Mã định danh không hợp lệ.');
    }
    return id;
  }
}
