import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { RedisHealthIndicator } from './redis.health';
import { SystemController } from './system.controller';
import { ShutdownService } from './shutdown.service';

/** Health check (readiness/liveness) và điều phối tắt êm (ADR-0012). */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController, SystemController],
  providers: [HealthService, RedisHealthIndicator, ShutdownService],
  // Worker BullMQ chờ `ShutdownService.drained()` trước khi đóng.
  exports: [ShutdownService],
})
export class HealthModule {}
