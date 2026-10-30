import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Role, TicketStatus } from '@prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { toPage } from '../../common/pagination';
import type { AuthUser } from '../auth/auth.types';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ListMyTicketsQuery, ListTicketsQuery } from './dto/list-tickets.query';
import { CountedTicketPageDto, TicketDetailDto, TicketDto } from './dto/ticket.response';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TICKET_CREATED, TicketCreatedEvent } from './events/ticket-created.event';
import { TicketRecord, TicketsRepository, TicketSummaryRecord } from './tickets.repository';

/** Vai trò làm việc với ticket ngoài chủ ticket (kho không tham gia hỗ trợ). */
export const SUPPORT_ROLES: readonly Role[] = [Role.SUPPORT, Role.ADMIN];

export const isSupportStaff = (user: AuthUser) => SUPPORT_ROLES.includes(user.role);

export interface CreateTicketOutcome {
  ticket: TicketDetailDto;
  /** true: trả lại ticket đã tạo trước đó với cùng Idempotency-Key. */
  replayed: boolean;
}

/** Khách chỉ thấy thông tin của mình; nhân viên thấy thêm khách là ai. */
export function toTicketView(ticket: TicketSummaryRecord, viewer: AuthUser): TicketDto {
  const { id, code, subject, status, category, categorySource, orderId, order } = ticket;
  return {
    id,
    code,
    subject,
    status,
    category,
    categorySource,
    orderId,
    orderCode: order?.code ?? null,
    ...(isSupportStaff(viewer) && { customer: ticket.customer }),
    lastMessageAt: ticket.lastMessageAt,
    createdAt: ticket.createdAt,
  };
}

export function toTicketDetail(ticket: TicketRecord, viewer: AuthUser): TicketDetailDto {
  return {
    ...toTicketView(ticket, viewer),
    messages: ticket.messages.map(({ id, body, createdAt, author }) => ({
      id,
      body,
      createdAt,
      author,
    })),
  };
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly ticketsRepository: TicketsRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    customer: AuthUser,
    dto: CreateTicketDto,
    idempotencyKey?: string,
  ): Promise<CreateTicketOutcome> {
    const replay = await this.findReplay(customer, idempotencyKey);
    if (replay) return replay;

    if (dto.orderId && !(await this.ticketsRepository.orderBelongsTo(dto.orderId, customer.id))) {
      throw new AppException(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng.');
    }

    const result = await this.ticketsRepository.create({
      customerId: customer.id,
      subject: dto.subject,
      message: dto.message,
      orderId: dto.orderId,
      idempotencyKey,
    });
    if (result.status === 'duplicate') {
      const existing = await this.findReplay(customer, idempotencyKey);
      if (existing) return existing;
      throw new AppException(
        HttpStatus.CONFLICT,
        'IDEMPOTENCY_CONFLICT',
        'Yêu cầu tạo ticket này đang được xử lý, vui lòng thử lại sau giây lát.',
      );
    }

    // Sau commit (ADR-0004): listener đẩy job phân loại, request không chờ LLM.
    this.eventEmitter.emit(
      TICKET_CREATED,
      new TicketCreatedEvent(result.ticket.id, result.ticket.code, customer.id),
    );
    return { ticket: toTicketDetail(result.ticket, customer), replayed: false };
  }

  async listMine(customer: AuthUser, query: ListMyTicketsQuery): Promise<CountedTicketPageDto> {
    const { page, limit, status, q } = query;
    const { items, total, statusCounts } = await this.ticketsRepository.findPageByCustomer(
      customer.id,
      { statuses: status, q },
      (page - 1) * limit,
      limit,
    );
    return {
      ...toPage(
        items.map((t) => toTicketView(t, customer)),
        total,
        page,
        limit,
      ),
      statusCounts,
    };
  }

  async list(staff: AuthUser, query: ListTicketsQuery): Promise<CountedTicketPageDto> {
    const { page, limit, status, category, q } = query;
    const { items, total, statusCounts } = await this.ticketsRepository.findPage(
      { status, category, q },
      (page - 1) * limit,
      limit,
    );
    return {
      ...toPage(
        items.map((t) => toTicketView(t, staff)),
        total,
        page,
        limit,
      ),
      statusCounts,
    };
  }

  /** Chủ ticket hoặc nhân viên hỗ trợ; người khác nhận 404 (không lộ ticket có tồn tại hay không). */
  async findOne(user: AuthUser, ticketId: string): Promise<TicketDetailDto> {
    return toTicketDetail(await this.findAccessible(user, ticketId), user);
  }

  /** Khách nhắn → OPEN (chờ nhân viên); nhân viên nhắn → ANSWERED (chờ khách). */
  async addMessage(user: AuthUser, ticketId: string, body: string): Promise<TicketDetailDto> {
    await this.findAccessible(user, ticketId);
    const nextStatus = isSupportStaff(user) ? TicketStatus.ANSWERED : TicketStatus.OPEN;
    const result = await this.ticketsRepository.addMessage(ticketId, user.id, body, nextStatus);
    switch (result.status) {
      case 'added':
        return toTicketDetail(result.ticket, user);
      case 'closed':
        throw new AppException(
          HttpStatus.CONFLICT,
          'TICKET_CLOSED',
          'Ticket đã đóng, không thể gửi thêm tin nhắn. Vui lòng tạo ticket mới.',
        );
      case 'not_found':
        throw ticketNotFound();
    }
  }

  async update(staff: AuthUser, ticketId: string, dto: UpdateTicketDto): Promise<TicketDetailDto> {
    if (!dto.status && !dto.category) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Cần ít nhất một trong hai trường: status hoặc category.',
      );
    }
    const ticket = await this.ticketsRepository.update(ticketId, dto);
    if (!ticket) throw ticketNotFound();
    return toTicketDetail(ticket, staff);
  }

  private async findAccessible(user: AuthUser, ticketId: string): Promise<TicketRecord> {
    const ticket = await this.ticketsRepository.findById(ticketId);
    if (!ticket || (ticket.customerId !== user.id && !isSupportStaff(user))) {
      throw ticketNotFound();
    }
    return ticket;
  }

  private async findReplay(
    customer: AuthUser,
    idempotencyKey?: string,
  ): Promise<CreateTicketOutcome | null> {
    if (!idempotencyKey) return null;
    const existing = await this.ticketsRepository.findByIdempotencyKey(customer.id, idempotencyKey);
    return existing ? { ticket: toTicketDetail(existing, customer), replayed: true } : null;
  }
}

export function ticketNotFound(): AppException {
  return new AppException(HttpStatus.NOT_FOUND, 'TICKET_NOT_FOUND', 'Không tìm thấy ticket.');
}
