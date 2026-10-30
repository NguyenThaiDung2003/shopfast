import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { ParseUuidPipe } from '../../common/pipes/parse-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-error-responses.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { IdempotencyKey, IdempotencyKeyPipe } from '../orders/idempotency-key.pipe';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { SupportAgentService } from './agent/support-agent.service';
import { AddTicketMessageDto } from './dto/add-ticket-message.dto';
import { AskAssistantDto } from './dto/ask-assistant.dto';
import { AssistantReplyDto } from './dto/assistant-reply.response';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ListMyTicketsQuery, ListTicketsQuery } from './dto/list-tickets.query';
import { CountedTicketPageDto, TicketDetailDto } from './dto/ticket.response';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketsService } from './tickets.service';

@ApiTags('Support')
@ApiBearerAuth('bearer')
@Controller('support/tickets')
export class TicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly agent: SupportAgentService,
  ) {}

  /**
   * Tạo ticket hỗ trợ (khách)
   *
   * Nhóm ticket được phân loại tự động bằng LLM ở nền (queue ticket-classify), nên lúc tạo
   * `category` là null. 201 khi tạo mới; 200 + `Idempotent-Replayed: true` khi gửi lại cùng
   * Idempotency-Key.
   */
  @Post()
  @Roles(Role.CUSTOMER)
  @RateLimit('ticketCreate')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Chuỗi 8–100 ký tự [A-Za-z0-9_-], nên là UUID mới cho mỗi lần bấm "Gửi".',
  })
  @ApiCreatedResponse({ type: TicketDetailDto, description: 'Ticket mới' })
  @ApiOkResponse({ type: TicketDetailDto, description: 'Ticket đã tạo trước đó với cùng key' })
  @ApiErrorResponses(400, 401, 403, 404, 409, 429)
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTicketDto,
    @IdempotencyKey(IdempotencyKeyPipe) idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TicketDetailDto> {
    const { ticket, replayed } = await this.ticketsService.create(user, dto, idempotencyKey);
    if (replayed) {
      res.status(HttpStatus.OK).setHeader('Idempotent-Replayed', 'true');
    }
    return ticket;
  }

  /**
   * Ticket của tôi (mới nhất trước)
   *
   * Lọc theo `status` (nhiều giá trị cách nhau dấu phẩy) và tìm theo mã/tiêu đề bằng `q`.
   * `statusCounts` đếm theo từ khoá nhưng không theo `status`, để mọi tab đều có số.
   */
  // Khai báo trước ':id' để "me" không bị ParseUuidPipe bắt.
  @Get('me')
  @Roles(Role.CUSTOMER)
  @ApiErrorResponses(400, 401, 403)
  listMine(
    @CurrentUser() user: AuthUser,
    @Query() query: ListMyTicketsQuery,
  ): Promise<CountedTicketPageDto> {
    return this.ticketsService.listMine(user, query);
  }

  /**
   * Hàng chờ ticket (nhân viên hỗ trợ), ticket có tin mới nhất lên trước
   *
   * Lọc theo `status`, `category`; tìm bằng `q` (mã ticket, tiêu đề, mã đơn, tên/email khách).
   * `statusCounts` áp `category` và `q` nhưng không áp `status`.
   */
  @Get()
  @Roles(Role.SUPPORT, Role.ADMIN)
  @ApiErrorResponses(400, 401, 403)
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListTicketsQuery,
  ): Promise<CountedTicketPageDto> {
    return this.ticketsService.list(user, query);
  }

  /**
   * Chi tiết ticket kèm tin nhắn
   *
   * Chủ ticket hoặc nhân viên hỗ trợ. Người khác nhận 404 (không lộ ticket có tồn tại hay không).
   */
  @Get(':id')
  @ApiErrorResponses(400, 401, 404)
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<TicketDetailDto> {
    return this.ticketsService.findOne(user, id);
  }

  /**
   * Gửi tin nhắn vào ticket
   *
   * Khách nhắn → OPEN (chờ nhân viên); nhân viên nhắn → ANSWERED. Ticket đã đóng → 409.
   */
  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: TicketDetailDto })
  @ApiErrorResponses(400, 401, 404, 409)
  addMessage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: AddTicketMessageDto,
  ): Promise<TicketDetailDto> {
    return this.ticketsService.addMessage(user, id, dto.body);
  }

  /** Đóng/mở lại ticket hoặc sửa nhóm bằng tay (nhân viên hỗ trợ) */
  @Patch(':id')
  @Roles(Role.SUPPORT, Role.ADMIN)
  @ApiErrorResponses(400, 401, 403, 404)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateTicketDto,
  ): Promise<TicketDetailDto> {
    return this.ticketsService.update(user, id, dto);
  }

  /**
   * Hỏi trợ lý AI về ticket (nhân viên hỗ trợ)
   *
   * Trợ lý tra đơn/tồn kho bằng tool gọi service thật. Thao tác ghi (huỷ đơn, đổi trả) chỉ được
   * tạo thành đề xuất `pendingActions` – xác nhận ở `POST /support/pending-actions/:id/confirm`.
   * LLM lỗi, quá hạn hoặc đang tắt → 503 `AI_UNAVAILABLE`.
   */
  @Post(':id/assistant')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPPORT, Role.ADMIN)
  @RateLimit('aiAssistant')
  @ApiOkResponse({ type: AssistantReplyDto })
  @ApiErrorResponses(400, 401, 403, 404, 429, 503)
  ask(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: AskAssistantDto,
  ): Promise<AssistantReplyDto> {
    return this.agent.ask(user, id, dto.question);
  }
}
