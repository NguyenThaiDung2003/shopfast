import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { OrderRealtimeListener } from './order-realtime.listener';
import { OrderTrackingService } from './order-tracking.service';
import { OrdersGateway } from './orders.gateway';

/** Realtime theo dõi đơn qua Socket.IO (F02, ADR-0010). Adapter Redis gắn ở `configureApp`. */
@Module({
  imports: [AuthModule, OrdersModule],
  providers: [OrdersGateway, OrderTrackingService, OrderRealtimeListener],
})
export class RealtimeModule {}
