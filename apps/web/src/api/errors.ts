/** Thông điệp mặc định khi server không trả body chuẩn (khớp apps/api/src/common/messages/vi.ts). */
const DEFAULT_MESSAGES: Record<number, string> = {
  0: 'Không kết nối được máy chủ, vui lòng kiểm tra mạng và thử lại.',
  400: 'Yêu cầu không hợp lệ, vui lòng kiểm tra lại dữ liệu.',
  401: 'Bạn cần đăng nhập để tiếp tục.',
  403: 'Bạn không có quyền thực hiện thao tác này.',
  404: 'Không tìm thấy tài nguyên được yêu cầu.',
  409: 'Dữ liệu bị xung đột, vui lòng thử lại.',
  422: 'Dữ liệu không thể xử lý.',
  429: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.',
  503: 'Hệ thống đang bận, vui lòng thử lại sau.',
};
const FALLBACK_MESSAGE = 'Đã có lỗi xảy ra, vui lòng thử lại sau.';

export function defaultMessage(status: number): string {
  return DEFAULT_MESSAGES[status] ?? FALLBACK_MESSAGE;
}

/** Lỗi API đã chuẩn hoá theo body `{ statusCode, code, message, details }` của HttpExceptionFilter. */
export class ApiError extends Error {
  constructor(
    /** Mã HTTP; 0 = lỗi mạng/không tới được server. */
    readonly status: number,
    /** Mã lỗi nghiệp vụ, ví dụ `VALIDATION_FAILED`, `INSUFFICIENT_STOCK`, `NETWORK_ERROR`. */
    readonly code: string,
    message: string,
    readonly details?: unknown,
    /** Chỉ có ở 429: số giây phải chờ (từ `Retry-After`). */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Thông điệp tiếng Việt hiển thị được cho mọi loại lỗi. */
export function errorMessage(error: unknown): string {
  return isApiError(error) ? error.message : FALLBACK_MESSAGE;
}
