import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppException } from '../exceptions/app.exception';
import { defaultMessageFor } from '../messages/vi';

export interface ErrorResponseBody {
  statusCode: number;
  code: string;
  message: string;
  path: string;
  timestamp: string;
  details?: unknown;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponseBody = {
      statusCode: status,
      code: exception instanceof AppException ? exception.code : (HttpStatus[status] ?? 'ERROR'),
      message:
        exception instanceof AppException ? exception.userMessage : defaultMessageFor(status),
      path: request.url,
      timestamp: new Date().toISOString(),
    };
    if (exception instanceof AppException && exception.details !== undefined) {
      body.details = exception.details;
    }
    // Rate limit và khoá đăng nhập (ADR-0008) đều mang số giây chờ trong details.
    const retryAfter = retryAfterSeconds(body.details);
    if (status === HttpStatus.TOO_MANY_REQUESTS && retryAfter !== undefined) {
      response.setHeader('Retry-After', String(retryAfter));
    }

    response.status(status).json(body);
  }
}

function retryAfterSeconds(details: unknown): number | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const value = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
