import { ArgumentsHost, HttpStatus, NotFoundException } from '@nestjs/common';
import { AppException } from '../exceptions/app.exception';
import { HttpExceptionFilter } from './http-exception.filter';

function createHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const setHeader = jest.fn();
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status, setHeader }),
      getRequest: () => ({ method: 'GET', url: '/api/orders/1' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json, setHeader };
}

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  it('giữ nguyên thông điệp tiếng Việt của AppException', () => {
    const { host, status, json } = createHost();

    filter.catch(
      new AppException(HttpStatus.CONFLICT, 'OUT_OF_STOCK', 'Sản phẩm đã hết hàng.'),
      host,
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'OUT_OF_STOCK', message: 'Sản phẩm đã hết hàng.' }),
    );
    expect(json.mock.calls[0][0]).not.toHaveProperty('details');
  });

  it('kèm details khi AppException có dữ liệu có cấu trúc', () => {
    const { host, json } = createHost();
    const details = [{ productId: 1, requested: 3, available: 2 }];

    filter.catch(
      new AppException(HttpStatus.CONFLICT, 'OUT_OF_STOCK', 'Thiếu hàng.', details),
      host,
    );

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ details }));
  });

  it('429 có details.retryAfterSeconds → đặt header Retry-After', () => {
    const { host, status, setHeader } = createHost();

    filter.catch(
      new AppException(HttpStatus.TOO_MANY_REQUESTS, 'TOO_MANY_REQUESTS', 'Chậm lại.', {
        retryAfterSeconds: 42,
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(429);
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '42');
  });

  it('lỗi khác hoặc 429 không có số giây → không đặt Retry-After', () => {
    const { host, setHeader } = createHost();

    filter.catch(
      new AppException(HttpStatus.TOO_MANY_REQUESTS, 'OTP_TOO_MANY_ATTEMPTS', 'x'),
      host,
    );
    filter.catch(new AppException(HttpStatus.CONFLICT, 'X', 'y', { retryAfterSeconds: 5 }), host);

    expect(setHeader).not.toHaveBeenCalled();
  });

  it('thay thông điệp mặc định của Nest bằng tiếng Việt', () => {
    const { host, json } = createHost();

    filter.catch(new NotFoundException('Cannot GET /x'), host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Không tìm thấy tài nguyên được yêu cầu.',
      }),
    );
  });

  it('trả 500 với thông điệp chung và không lộ chi tiết lỗi', () => {
    const { host, status, json } = createHost();
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);

    filter.catch(new Error('connection refused at 10.0.0.5'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Đã có lỗi xảy ra, vui lòng thử lại sau.' }),
    );
  });
});
