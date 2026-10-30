import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ParseUuidPipe } from '../../common/pipes/parse-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-error-responses.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { DecidePendingActionDto } from './dto/decide-pending-action.dto';
import { ListPendingActionsQuery } from './dto/list-pending-actions.query';
import { PendingActionDto, PendingActionPageDto } from './dto/pending-action.response';
import { PendingActionsService } from './pending-actions.service';

/** Đề xuất thao tác ghi của trợ lý AI chờ người xác nhận (human-in-the-loop, ADR-0011). */
@ApiTags('Support')
@ApiBearerAuth('bearer')
@Roles(Role.SUPPORT, Role.ADMIN)
@Controller('support/pending-actions')
export class PendingActionsController {
  constructor(private readonly pendingActions: PendingActionsService) {}

  /** Danh sách đề xuất của trợ lý AI (mới nhất trước) */
  @Get()
  @ApiErrorResponses(400, 401, 403)
  list(@Query() query: ListPendingActionsQuery): Promise<PendingActionPageDto> {
    return this.pendingActions.list(query);
  }

  /**
   * Xác nhận và thực thi đề xuất
   *
   * Chỉ lúc này thao tác mới chạy (huỷ đơn qua state machine + hoàn kho; hoặc tạo yêu cầu đổi
   * trả). Điều kiện được kiểm lại tại thời điểm xác nhận. Đã xử lý trước đó hoặc đơn không còn
   * phù hợp → 409.
   */
  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PendingActionDto })
  @ApiErrorResponses(400, 401, 403, 404, 409, 503)
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: DecidePendingActionDto,
  ): Promise<PendingActionDto> {
    return this.pendingActions.confirm(user, id, dto.note);
  }

  /** Từ chối đề xuất – không thực thi gì */
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PendingActionDto })
  @ApiErrorResponses(400, 401, 403, 404, 409)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: DecidePendingActionDto,
  ): Promise<PendingActionDto> {
    return this.pendingActions.reject(user, id, dto.note);
  }
}
