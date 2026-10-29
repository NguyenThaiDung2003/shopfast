import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Lỗi nghiệp vụ có thông điệp tiếng Việt dành cho người dùng.
 * Service ném AppException; mọi lỗi khác được filter thay bằng thông điệp mặc định.
 */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    readonly userMessage: string,
  ) {
    super({ code, message: userMessage }, status);
  }
}
