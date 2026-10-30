export const TICKET_CREATED = 'ticket.created';

/** Phát sau khi transaction tạo ticket đã commit. Listener: đẩy job phân loại (F06, ADR-0011). */
export class TicketCreatedEvent {
  constructor(
    readonly ticketId: string,
    readonly code: string,
    readonly customerId: string,
    readonly occurredAt: Date = new Date(),
  ) {}
}
