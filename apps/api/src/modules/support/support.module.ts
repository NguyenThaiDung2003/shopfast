import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { LlmModule } from '../llm/llm.module';
import { OrdersModule } from '../orders/orders.module';
import { AgentToolsService } from './agent/agent-tools';
import { SupportAgentService } from './agent/support-agent.service';
import { PendingActionsController } from './pending-actions.controller';
import { PendingActionsRepository } from './pending-actions.repository';
import { PendingActionsService } from './pending-actions.service';
import { TicketClassifierService } from './ticket-classifier.service';
import { TicketsController } from './tickets.controller';
import { TicketsRepository } from './tickets.repository';
import { TicketsService } from './tickets.service';

/** Ticket hỗ trợ, phân loại bằng LLM và trợ lý AI cho nhân viên (F06, ADR-0011). */
@Module({
  imports: [LlmModule, OrdersModule, CatalogModule],
  controllers: [TicketsController, PendingActionsController],
  providers: [
    TicketsService,
    TicketsRepository,
    PendingActionsService,
    PendingActionsRepository,
    TicketClassifierService,
    AgentToolsService,
    SupportAgentService,
  ],
  // Worker queue ticket-classify (JobsModule) gọi phân loại.
  exports: [TicketClassifierService],
})
export class SupportModule {}
