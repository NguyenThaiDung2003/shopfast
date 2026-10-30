import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { HttpStatus, INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Role } from '@prisma/client';
import { Queue } from 'bullmq';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { AppException } from '../../common/exceptions/app.exception';
import { TokenService } from '../auth/token.service';
import { ALL_QUEUES } from './queues';

export const BULL_BOARD_PATH = '/admin/queues';
/** Cookie phiên của Bull Board, đặt bởi POST /api/admin/queues/session. */
export const BULL_BOARD_COOKIE = 'sf_admin_queues';

/**
 * Bull Board là app Express riêng, nằm ngoài guard của Nest: middleware tự kiểm access token
 * (header Bearer hoặc cookie phiên) và vai trò ADMIN, trả lỗi đúng định dạng chuẩn (ADR-0009).
 */
export function adminQueuesAuth(tokenService: TokenService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const [scheme, bearer] = req.headers.authorization?.split(' ') ?? [];
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const token = scheme === 'Bearer' && bearer ? bearer : cookies?.[BULL_BOARD_COOKIE];
    try {
      if (!token) {
        throw new AppException(
          HttpStatus.UNAUTHORIZED,
          'UNAUTHENTICATED',
          'Bạn cần đăng nhập bằng tài khoản quản trị để xem hàng đợi.',
        );
      }
      const user = await tokenService.verifyAccessToken(token);
      if (user.role !== Role.ADMIN) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'Bạn không có quyền thực hiện thao tác này.',
        );
      }
      next();
    } catch (error) {
      const exception =
        error instanceof AppException
          ? error
          : new AppException(
              HttpStatus.UNAUTHORIZED,
              'UNAUTHENTICATED',
              'Bạn cần đăng nhập để tiếp tục.',
            );
      res.status(exception.getStatus()).json({
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.userMessage,
        path: req.originalUrl,
        timestamp: new Date().toISOString(),
      });
    }
  };
}

/** Gắn Bull Board vào `/admin/queues` (ngoài global prefix /api). */
export function setupBullBoard(app: INestApplication): void {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);
  createBullBoard({
    queues: ALL_QUEUES.map((name) => new BullMQAdapter(app.get<Queue>(getQueueToken(name)))),
    serverAdapter,
    options: { uiConfig: { boardTitle: 'ShopFast – Hàng đợi' } },
  });
  app.use(
    BULL_BOARD_PATH,
    cookieParser(),
    adminQueuesAuth(app.get(TokenService)),
    serverAdapter.getRouter(),
  );
}
