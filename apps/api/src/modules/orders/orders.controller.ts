import { Controller, Get, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { Page } from '../../common/pagination';
import { ParseUuidPipe } from '../../common/pipes/parse-id.pipe';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ListOrdersQuery } from './dto/list-orders.query';
import { IdempotencyKey, IdempotencyKeyPipe } from './idempotency-key.pipe';
import { OrdersService, OrderView } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /** 201 khi tạo mới; 200 + `Idempotent-Replayed: true` khi trả lại đơn của cùng Idempotency-Key. */
  @Post()
  @Roles(Role.CUSTOMER)
  async create(
    @CurrentUser() user: AuthUser,
    @IdempotencyKey(IdempotencyKeyPipe) idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderView> {
    const { order, replayed } = await this.ordersService.create(user, idempotencyKey);
    if (replayed) {
      res.status(HttpStatus.OK).setHeader('Idempotent-Replayed', 'true');
    }
    return order;
  }

  @Get()
  @Roles(Role.CUSTOMER)
  listMine(
    @CurrentUser() user: AuthUser,
    @Query() query: ListOrdersQuery,
  ): Promise<Page<OrderView>> {
    return this.ordersService.listMine(user, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUuidPipe) id: string,
  ): Promise<OrderView> {
    return this.ordersService.findOne(user, id);
  }
}
