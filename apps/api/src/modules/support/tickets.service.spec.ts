import { EventEmitter2 } from '@nestjs/event-emitter';
import { Role, TicketCategory, TicketStatus } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { TICKET_CREATED, TicketCreatedEvent } from './events/ticket-created.event';
import { TicketRecord, TicketsRepository } from './tickets.repository';
import { TicketsService } from './tickets.service';

const customer: AuthUser = { id: 'cust-1', role: Role.CUSTOMER };
const otherCustomer: AuthUser = { id: 'cust-2', role: Role.CUSTOMER };
const support: AuthUser = { id: 'sup-1', role: Role.SUPPORT };
const warehouse: AuthUser = { id: 'wh-1', role: Role.WAREHOUSE };
const KEY = 'key-12345678';

const ticket: TicketRecord = {
  id: 'tk-1',
  code: 'TK-000001',
  customerId: customer.id,
  subject: 'Giao chậm',
  status: TicketStatus.OPEN,
  category: null,
  categorySource: null,
  orderId: null,
  lastMessageAt: new Date(),
  createdAt: new Date(),
  order: null,
  customer: { id: customer.id, fullName: 'Khách A', email: 'a@shopfast.local' },
  messages: [
    {
      id: 1,
      body: 'Chưa thấy giao',
      createdAt: new Date(),
      author: { role: Role.CUSTOMER, fullName: 'Khách A' },
    },
  ],
};

function setup() {
  const repository = {
    create: jest.fn().mockResolvedValue({ status: 'created', ticket }),
    findById: jest.fn().mockResolvedValue(ticket),
    findByIdempotencyKey: jest.fn().mockResolvedValue(null),
    orderBelongsTo: jest.fn().mockResolvedValue(true),
    findPageByCustomer: jest.fn().mockResolvedValue({
      items: [ticket],
      total: 1,
      statusCounts: { OPEN: 1, ANSWERED: 0, CLOSED: 2 },
    }),
    findPage: jest.fn().mockResolvedValue({
      items: [ticket],
      total: 1,
      statusCounts: { OPEN: 1, ANSWERED: 0, CLOSED: 0 },
    }),
    addMessage: jest.fn().mockResolvedValue({ status: 'added', ticket }),
    update: jest.fn().mockResolvedValue(ticket),
  };
  const eventEmitter = { emit: jest.fn() };
  const service = new TicketsService(
    repository as unknown as TicketsRepository,
    eventEmitter as unknown as EventEmitter2,
  );
  return { service, repository, eventEmitter };
}

describe('TicketsService.create', () => {
  it('lưu ticket rồi mới phát ticket.created; khách không thấy thông tin customer', async () => {
    const { service, repository, eventEmitter } = setup();
    const order: string[] = [];
    repository.create.mockImplementation(() => {
      order.push('save');
      return Promise.resolve({ status: 'created', ticket });
    });
    eventEmitter.emit.mockImplementation(() => order.push('emit'));

    const { ticket: view, replayed } = await service.create(customer, {
      subject: 'Giao chậm',
      message: 'Chưa thấy giao',
    });

    expect(order).toEqual(['save', 'emit']);
    expect(replayed).toBe(false);
    expect(view.customer).toBeUndefined();
    expect(view.category).toBeNull();
    const [name, event] = eventEmitter.emit.mock.calls[0] as [string, TicketCreatedEvent];
    expect(name).toBe(TICKET_CREATED);
    expect(event).toMatchObject({ ticketId: 'tk-1', code: 'TK-000001', customerId: customer.id });
  });

  it('đơn không thuộc khách → 404 ORDER_NOT_FOUND, không tạo', async () => {
    const { service, repository } = setup();
    repository.orderBelongsTo.mockResolvedValue(false);

    await expect(
      service.create(customer, { subject: 's', message: 'm', orderId: 'o-1' }),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('gửi lại cùng Idempotency-Key → trả ticket cũ, không phát event', async () => {
    const { service, repository, eventEmitter } = setup();
    repository.findByIdempotencyKey.mockResolvedValue(ticket);

    const { replayed } = await service.create(customer, { subject: 's', message: 'm' }, KEY);

    expect(replayed).toBe(true);
    expect(repository.create).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('hai request cùng key đồng thời → request thua trả ticket của request thắng', async () => {
    const { service, repository, eventEmitter } = setup();
    repository.create.mockResolvedValue({ status: 'duplicate' });
    repository.findByIdempotencyKey.mockResolvedValueOnce(null).mockResolvedValueOnce(ticket);

    const { replayed } = await service.create(customer, { subject: 's', message: 'm' }, KEY);

    expect(replayed).toBe(true);
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('trùng key nhưng chưa đọc được ticket → 409', async () => {
    const { service, repository } = setup();
    repository.create.mockResolvedValue({ status: 'duplicate' });

    await expect(
      service.create(customer, { subject: 's', message: 'm' }, KEY),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});

describe('TicketsService – quyền xem', () => {
  it('chủ ticket và nhân viên hỗ trợ xem được; nhân viên thấy khách là ai', async () => {
    const { service } = setup();
    await expect(service.findOne(customer, 'tk-1')).resolves.toMatchObject({ code: 'TK-000001' });
    await expect(service.findOne(support, 'tk-1')).resolves.toMatchObject({
      customer: { email: 'a@shopfast.local' },
    });
  });

  it.each([
    ['khách khác', otherCustomer],
    ['nhân viên kho', warehouse],
  ])('%s → 404 TICKET_NOT_FOUND', async (_label, user) => {
    const { service } = setup();
    await expect(service.findOne(user, 'tk-1')).rejects.toMatchObject({
      code: 'TICKET_NOT_FOUND',
    });
  });

  it('không tồn tại → 404', async () => {
    const { service, repository } = setup();
    repository.findById.mockResolvedValue(null);
    await expect(service.findOne(support, 'x')).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' });
  });
});

describe('TicketsService.addMessage', () => {
  it('khách nhắn → OPEN; nhân viên nhắn → ANSWERED', async () => {
    const { service, repository } = setup();
    await service.addMessage(customer, 'tk-1', 'Còn chờ');
    await service.addMessage(support, 'tk-1', 'Đơn đang giao');
    expect(repository.addMessage.mock.calls).toEqual([
      ['tk-1', customer.id, 'Còn chờ', TicketStatus.OPEN],
      ['tk-1', support.id, 'Đơn đang giao', TicketStatus.ANSWERED],
    ]);
  });

  it('ticket đã đóng → 409 TICKET_CLOSED', async () => {
    const { service, repository } = setup();
    repository.addMessage.mockResolvedValue({ status: 'closed' });
    await expect(service.addMessage(customer, 'tk-1', 'x')).rejects.toMatchObject({
      code: 'TICKET_CLOSED',
    });
  });

  it('khách khác không nhắn được → 404, không ghi', async () => {
    const { service, repository } = setup();
    await expect(service.addMessage(otherCustomer, 'tk-1', 'x')).rejects.toMatchObject({
      code: 'TICKET_NOT_FOUND',
    });
    expect(repository.addMessage).not.toHaveBeenCalled();
  });

  it('bị xoá giữa chừng → 404', async () => {
    const { service, repository } = setup();
    repository.addMessage.mockResolvedValue({ status: 'not_found' });
    await expect(service.addMessage(support, 'tk-1', 'x')).rejects.toMatchObject({
      code: 'TICKET_NOT_FOUND',
    });
  });
});

describe('TicketsService – danh sách và cập nhật', () => {
  it('listMine theo khách; list theo bộ lọc', async () => {
    const { service, repository } = setup();
    const mine = await service.listMine(customer, {
      page: 2,
      limit: 10,
      status: [TicketStatus.OPEN, TicketStatus.ANSWERED],
      q: 'TK-0001',
    });
    const queue = await service.list(support, {
      page: 2,
      limit: 5,
      status: TicketStatus.OPEN,
      category: TicketCategory.VAN_CHUYEN,
      q: 'Minh',
    });
    expect(repository.findPageByCustomer).toHaveBeenCalledWith(
      customer.id,
      { statuses: [TicketStatus.OPEN, TicketStatus.ANSWERED], q: 'TK-0001' },
      10,
      10,
    );
    expect(mine.statusCounts).toEqual({ OPEN: 1, ANSWERED: 0, CLOSED: 2 });
    expect(mine.meta).toMatchObject({ page: 2, total: 1 });
    expect(mine.items[0]).not.toHaveProperty('customer');
    expect(repository.findPage).toHaveBeenCalledWith(
      { status: TicketStatus.OPEN, category: TicketCategory.VAN_CHUYEN, q: 'Minh' },
      5,
      5,
    );
    expect(queue.statusCounts).toEqual({ OPEN: 1, ANSWERED: 0, CLOSED: 0 });
    expect(queue.items[0]).toHaveProperty('customer');
  });

  it('update cần ít nhất một trường; không tồn tại → 404', async () => {
    const { service, repository } = setup();
    await expect(service.update(support, 'tk-1', {})).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    repository.update.mockResolvedValue(null);
    await expect(
      service.update(support, 'tk-1', { status: TicketStatus.CLOSED }),
    ).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' });
  });
});
