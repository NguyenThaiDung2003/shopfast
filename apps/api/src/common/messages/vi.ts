import { HttpStatus } from '@nestjs/common';

// Thông điệp mặc định trả cho người dùng theo mã HTTP, khi lỗi không mang thông điệp riêng.
export const DEFAULT_ERROR_MESSAGES: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Yêu cầu không hợp lệ, vui lòng kiểm tra lại dữ liệu.',
  [HttpStatus.UNAUTHORIZED]: 'Bạn cần đăng nhập để tiếp tục.',
  [HttpStatus.FORBIDDEN]: 'Bạn không có quyền thực hiện thao tác này.',
  [HttpStatus.NOT_FOUND]: 'Không tìm thấy tài nguyên được yêu cầu.',
  [HttpStatus.CONFLICT]: 'Dữ liệu bị xung đột, vui lòng thử lại.',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Dữ liệu không thể xử lý.',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Hệ thống đang bận, vui lòng thử lại sau.',
};

export const FALLBACK_ERROR_MESSAGE = 'Đã có lỗi xảy ra, vui lòng thử lại sau.';

export function defaultMessageFor(status: number): string {
  return DEFAULT_ERROR_MESSAGES[status as HttpStatus] ?? FALLBACK_ERROR_MESSAGE;
}
