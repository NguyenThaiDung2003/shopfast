import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto';

const DESCRIPTIONS: Record<number, string> = {
  400: 'Dữ liệu không hợp lệ (VALIDATION_FAILED, …)',
  401: 'Chưa đăng nhập hoặc token hết hạn (UNAUTHENTICATED, TOKEN_EXPIRED)',
  403: 'Sai vai trò (FORBIDDEN_ROLE)',
  404: 'Không tìm thấy',
  409: 'Xung đột nghiệp vụ (hết hàng, chuyển trạng thái sai, …)',
  429: 'Vượt giới hạn tần suất',
  503: 'Hệ thống bận hoặc dịch vụ phụ trợ tạm gián đoạn',
};

/** Khai báo các response lỗi chuẩn `{ statusCode, code, message, … }` cho một endpoint. */
export function ApiErrorResponses(...statuses: number[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({ status, description: DESCRIPTIONS[status], type: ErrorResponseDto }),
    ),
  );
}
