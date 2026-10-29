import { Body, Controller, Get, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { ApiErrorResponses } from '../../common/swagger/api-error-responses.decorator';
import { ParseUuidPipe } from '../../common/pipes/parse-id.pipe';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ListOrdersQuery } from './dto/list-orders.query';
import { OrderDto, OrderPageDto } from './dto/order.response';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { IdempotencyKey, IdempotencyKeyPipe } from './idempotency-key.pipe';
import { OrdersService } from './orders.service';

@ApiTags('Orders')
@ApiBearerAuth('bearer')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * Tạo đơn từ giỏ hàng
   *
   * Trừ kho nguyên tử trong một transaction (ADR-0005). 201 khi tạo mới; 200 + header
   * `Idempotent-Replayed: true` khi gửi lại cùng Idempotency-Key. Thiếu hàng → 409 `OUT_OF_STOCK`.
   */
  @Post()
  @Roles(Role.CUSTOMER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Chuỗi 8–100 ký tự [A-Za-z0-9_-], nên là UUID mới cho mỗi lần bấm "Đặt hàng".',
  })
  @ApiCreatedResponse({ type: OrderDto, description: 'Đơn mới' })
  @ApiOkResponse({ type: OrderDto, description: 'Đơn đã tạo trước đó với cùng Idempotency-Key' })
  @ApiErrorResponses(400, 401, 403, 409, 503)
  async create(
    @CurrentUser() user: AuthUser,
    @IdempotencyKey(IdempotencyKeyPipe) idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderDto> {
    const { order, replayed } = await this.ordersService.create(user, idempotencyKey);
    if (replayed) {
      res.status(HttpStatus.OK).setHeader('Idempotent-Replayed', 'true');
    }
    return order;
  }

  /** Lịch sử đơn của tôi (mới nhất trước) */
  // Khai báo trước ':id' để "me" không bị ParseUuidPipe bắt.
  @Get('me')
  @Roles(Role.CUSTOMER)
  @ApiErrorResponses(400, 401, 403)
  listMine(@CurrentUser() user: AuthUser, @Query() query: ListOrdersQuery): Promise<OrderPageDto> {
    return this.ordersService.listMine(user, query);
  }

  /**
   * Chi tiết đơn
   *
   * Chủ đơn hoặc nhân viên. Customer khác nhận 404 (không lộ đơn có tồn tại hay không).
   */
  @Get(':id')
  @ApiErrorResponses(400, 401, 404)
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<OrderDto> {
    return this.ordersService.findOne(user, id);
  }

  /**
   * Cập nhật trạng thái đơn (kho)
   *
   * PENDING_PAYMENT → PAID → PROCESSING → SHIPPING → DELIVERED; CANCELLED từ PENDING_PAYMENT,
   * PAID, PROCESSING (huỷ thì hoàn kho). Bước không hợp lệ hoặc bị người khác đổi trước → 409.
   */
  @Patch(':id/status')
  @Roles(Role.WAREHOUSE, Role.ADMIN)
  @ApiErrorResponses(400, 401, 403, 404, 409, 503)
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ): Promise<OrderDto> {
    return this.ordersService.changeStatus(user, id, dto);
  }
}
