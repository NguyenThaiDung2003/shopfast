import { Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Request, Response } from 'express';
import { ApiErrorResponses } from '../../common/swagger/api-error-responses.decorator';
import type { EnvironmentVariables } from '../../config/env.validation';
import { Roles } from '../auth/decorators/roles.decorator';
import { BULL_BOARD_COOKIE, BULL_BOARD_PATH } from './bull-board';
import { QueuesStatsDto } from './dto/queue-stats.response';
import { QueueStatsService } from './queue-stats.service';

@ApiTags('Admin')
@ApiBearerAuth('bearer')
@Roles(Role.ADMIN)
@Controller('admin/queues')
export class JobsAdminController {
  private readonly secureCookie: boolean;

  constructor(
    private readonly queueStats: QueueStatsService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.secureCookie = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  /** Số job theo trạng thái của từng queue (chỉ ADMIN) */
  @Get('stats')
  @ApiErrorResponses(401, 403, 503)
  stats(): Promise<QueuesStatsDto> {
    return this.queueStats.getStats();
  }

  /**
   * Mở phiên xem Bull Board (chỉ ADMIN)
   *
   * Trình duyệt không gửi được header Bearer khi mở `/admin/queues`, nên endpoint này đặt cookie
   * httpOnly (chỉ gửi kèm đường dẫn /admin/queues) chứa access token hiện tại; hết hạn cùng token.
   */
  @Post('session')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Đã đặt cookie, mở /admin/queues trên cùng trình duyệt' })
  @ApiErrorResponses(401, 403)
  openSession(@Req() req: Request, @Res({ passthrough: true }) res: Response): void {
    // JwtAuthGuard đã kiểm header này hợp lệ.
    const token = req.headers.authorization!.split(' ')[1]!;
    res.cookie(BULL_BOARD_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.secureCookie,
      path: BULL_BOARD_PATH,
      maxAge: this.queueStats.sessionMaxAgeMs(token),
    });
  }
}
