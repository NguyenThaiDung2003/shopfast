import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser, ClientContext } from '../auth.types';

export type AuthenticatedRequest = Request & { user?: AuthUser };

/** User đã xác thực; chỉ dùng ở endpoint không có @Public(). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user as AuthUser,
);

/** User-Agent và IP của client, lưu kèm refresh token để audit. */
export const ClientInfo = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ClientContext => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return { userAgent: request.get('user-agent')?.slice(0, 255), ip: request.ip };
  },
);
