import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Lỗi nghiệp vụ có thông điệp tiếng Việt dành cho người dùng.
 * Service ném AppException; mọi lỗi khác được filter thay bằng thông điệp mặc định.
 * `details` (tuỳ chọn) là dữ liệu có cấu trúc cho client, ví dụ danh sách sản phẩm thiếu hàng.
 */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    readonly userMessage: string,
    readonly details?: unknown,
  ) {
    super({ code, message: userMessage }, status);
  }
}
