import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { OrdersController } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

@Module({
  imports: [CartModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository],
  // Realtime (F02) kiểm quyền theo dõi đơn bằng đúng luật của OrdersService.findOne.
  exports: [OrdersService],
})
export class OrdersModule {}
