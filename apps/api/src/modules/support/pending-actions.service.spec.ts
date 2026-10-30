import { HttpStatus, Logger } from '@nestjs/common';
import { OrderStatus, PendingActionStatus, PendingActionType, Prisma, Role } from '@prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../auth/auth.types';
import { OrderDto } from '../orders/dto/order.response';
import { OrdersService } from '../orders/orders.service';
import { PendingActionRecord, PendingActionsRepository } from './pending-actions.repository';
import { PendingActionsService, toPendingActionView } from './pending-actions.service';

const staff: AuthUser = { id: 'sup-1', role: Role.SUPPORT };
const ORDER_ID = '0b1f3c1e-1111-4111-8111-111111111111';

const orderIn = (status: OrderStatus): OrderDto => ({
  id: ORDER_ID,
  code: 'SF-000123',
  status,
  totalAmount: 100_000,
  paidAt: null,
  createdAt: new Date(),
  items: [],
  statusHistory: [],
});

const record = (
  type: PendingActionType,
  status: PendingActionStatus = PendingActionStatus.PENDING,
): PendingActionRecord => ({
  id: 'pa-1',
  type,
  status,
  payload: { reason: 'khách đổi ý' } as Prisma.JsonValue,
  summary: 'Huỷ đơn SF-000123',
  orderId: ORDER_ID,
  ticketId: 'tk-1',
  proposedById: 'sup-0',
  decidedById: null,
  decidedAt: null,
  decisionNote: null,
  errorCode: null,
  createdAt: new Date(),
  order: { code: 'SF-000123' },
  ticket: { code: 'TK-000007' },
});

function setup() {
  const repository = {
    create: jest.fn(),
    findById: jest.fn(),
    findPage: jest.fn(),
    claim: jest.fn().mockResolvedValue(true),
    releaseClaim: jest.fn(),
    reject: jest.fn().mockResolvedValue(true),
    markExecuted: jest.fn(),
    markFailed: jest.fn(),
    createReturnRequest: jest.fn(),
  };
  const ordersService = {
    findByRef: jest.fn(),
    changeStatus: jest.fn().mockResolvedValue(orderIn(OrderStatus.CANCELLED)),
  };
  const service = new PendingActionsService(
    repository as unknown as PendingActionsRepository,
    ordersService as unknown as OrdersService,
  );
  return { service, repository, ordersService };
}

beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
afterEach(() => jest.restoreAllMocks());

describe('PendingActionsService.propose – chỉ ghi đề xuất', () => {
  it('đơn huỷ được → tạo PENDING, không đổi trạng thái đơn', async () => {
    const { service, repository, ordersService } = setup();
    ordersService.findByRef.mockResolvedValue(orderIn(OrderStatus.PAID));
    repository.create.mockResolvedValue({
      status: 'created',
      action: record(PendingActionType.CANCEL_ORDER),
    });

    const { action, created } = await service.propose(staff, {
      type: PendingActionType.CANCEL_ORDER,
      orderRef: 'SF-000123',
      reason: 'khách đổi ý',
      ticketId: 'tk-1',
    });

    expect(created).toBe(true);
    expect(action.status).toBe(PendingActionStatus.PENDING);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: PendingActionType.CANCEL_ORDER,
        orderId: ORDER_ID,
        ticketId: 'tk-1',
        proposedById: staff.id,
        summary: expect.stringContaining('Đã thanh toán'),
      }),
    );
    expect(ordersService.changeStatus).not.toHaveBeenCalled();
  });

  it('đề xuất trùng (đang chờ) → trả lại đề xuất cũ, created=false', async () => {
    const { service, repository, ordersService } = setup();
    ordersService.findByRef.mockResolvedValue(orderIn(OrderStatus.PENDING_PAYMENT));
    repository.create.mockResolvedValue({
      status: 'duplicate',
      action: record(PendingActionType.CANCEL_ORDER),
    });

    const { created } = await service.propose(staff, {
      type: PendingActionType.CANCEL_ORDER,
      orderRef: 'SF-000123',
      reason: 'x x x',
    });
    expect(created).toBe(false);
  });

  it('đơn đang giao → 409 ORDER_NOT_CANCELLABLE, không ghi gì', async () => {
    const { service, repository, ordersService } = setup();
    ordersService.findByRef.mockResolvedValue(orderIn(OrderStatus.SHIPPING));

    await expect(
      service.propose(staff, {
        type: PendingActionType.CANCEL_ORDER,
        orderRef: 'SF-000123',
        reason: 'khách đổi ý',
      }),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_CANCELLABLE' });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('đổi trả cho đơn chưa giao → 409 ORDER_NOT_RETURNABLE', async () => {
    const { service, repository, ordersService } = setup();
    ordersService.findByRef.mockResolvedValue(orderIn(OrderStatus.PROCESSING));

    await expect(
      service.propose(staff, {
        type: PendingActionType.CREATE_RETURN_REQUEST,
        orderRef: 'SF-000123',
        reason: 'hàng lỗi',
      }),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_RETURNABLE' });
    expect(repository.create).not.toHaveBeenCalled();
  });
});

describe('PendingActionsService.confirm – chỉ thực thi khi người xác nhận', () => {
  it('huỷ đơn: giành quyền → changeStatus(CANCELLED) với ghi chú truy vết → EXECUTED', async () => {
    const { service, repository, ordersService } = setup();
    repository.findById
      .mockResolvedValueOnce(record(PendingActionType.CANCEL_ORDER))
      .mockResolvedValueOnce(record(PendingActionType.CANCEL_ORDER, PendingActionStatus.EXECUTED));

    const result = await service.confirm(staff, 'pa-1', 'đã gọi khách');

    expect(repository.claim).toHaveBeenCalledWith('pa-1', staff.id, 'đã gọi khách');
    expect(ordersService.changeStatus).toHaveBeenCalledWith(staff, ORDER_ID, {
      status: OrderStatus.CANCELLED,
      note: expect.stringContaining('TK-000007'),
    });
    expect(repository.markExecuted).toHaveBeenCalledWith('pa-1');
    expect(result.status).toBe(PendingActionStatus.EXECUTED);
  });

  it('đổi trả: tạo yêu cầu trong repository (transaction)', async () => {
    const { service, repository, ordersService } = setup();
    repository.findById.mockResolvedValue(record(PendingActionType.CREATE_RETURN_REQUEST));
    repository.createReturnRequest.mockResolvedValue({
      status: 'created',
      returnRequestId: 'rr-1',
    });

    await service.confirm(staff, 'pa-1');

    expect(repository.createReturnRequest).toHaveBeenCalledWith(
      'pa-1',
      ORDER_ID,
      'khách đổi ý',
      staff.id,
    );
    expect(ordersService.changeStatus).not.toHaveBeenCalled();
  });

  it('đã có người xác nhận/từ chối trước → 409 ACTION_ALREADY_DECIDED, không chạy lại', async () => {
    const { service, repository, ordersService } = setup();
    repository.findById
      .mockResolvedValueOnce(record(PendingActionType.CANCEL_ORDER))
      .mockResolvedValueOnce(record(PendingActionType.CANCEL_ORDER, PendingActionStatus.EXECUTED));
    repository.claim.mockResolvedValue(false);

    await expect(service.confirm(staff, 'pa-1')).rejects.toMatchObject({
      code: 'ACTION_ALREADY_DECIDED',
      details: { status: PendingActionStatus.EXECUTED },
    });
    expect(ordersService.changeStatus).not.toHaveBeenCalled();
  });

  it('đơn đã đổi trạng thái (không còn huỷ được) → FAILED + lỗi gốc 409', async () => {
    const { service, repository, ordersService } = setup();
    repository.findById.mockResolvedValue(record(PendingActionType.CANCEL_ORDER));
    const invalid = new AppException(
      HttpStatus.CONFLICT,
      'INVALID_STATUS_TRANSITION',
      'Không thể chuyển đơn từ "Đang giao" sang "Đã huỷ".',
    );
    ordersService.changeStatus.mockRejectedValue(invalid);

    await expect(service.confirm(staff, 'pa-1')).rejects.toBe(invalid);
    expect(repository.markFailed).toHaveBeenCalledWith('pa-1', 'INVALID_STATUS_TRANSITION');
    expect(repository.markExecuted).not.toHaveBeenCalled();
  });

  it('hệ thống bận (ORDER_BUSY) → trả về PENDING để xác nhận lại', async () => {
    const { service, repository, ordersService } = setup();
    repository.findById.mockResolvedValue(record(PendingActionType.CANCEL_ORDER));
    ordersService.changeStatus.mockRejectedValue(
      new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'ORDER_BUSY', 'Hệ thống đang đông.'),
    );

    await expect(service.confirm(staff, 'pa-1')).rejects.toMatchObject({ code: 'ORDER_BUSY' });
    expect(repository.releaseClaim).toHaveBeenCalledWith('pa-1');
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it('đã huỷ đơn nhưng ghi EXECUTED lỗi → KHÔNG trả về PENDING (tránh huỷ hai lần)', async () => {
    const { service, repository } = setup();
    repository.findById.mockResolvedValue(record(PendingActionType.CANCEL_ORDER));
    repository.markExecuted.mockRejectedValue(new Error('db down'));

    await service.confirm(staff, 'pa-1');

    expect(repository.releaseClaim).not.toHaveBeenCalled();
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 'not_delivered', orderStatus: OrderStatus.CANCELLED }, 'ORDER_NOT_RETURNABLE'],
    [{ status: 'duplicate' }, 'RETURN_REQUEST_EXISTS'],
  ])('đổi trả %o → FAILED %s', async (outcome, code) => {
    const { service, repository } = setup();
    repository.findById.mockResolvedValue(record(PendingActionType.CREATE_RETURN_REQUEST));
    repository.createReturnRequest.mockResolvedValue(outcome);

    await expect(service.confirm(staff, 'pa-1')).rejects.toMatchObject({ code });
    expect(repository.markFailed).toHaveBeenCalledWith('pa-1', code);
  });

  it('không tồn tại → 404', async () => {
    const { service, repository } = setup();
    repository.findById.mockResolvedValue(null);

    await expect(service.confirm(staff, 'pa-x')).rejects.toMatchObject({
      code: 'PENDING_ACTION_NOT_FOUND',
    });
    expect(repository.claim).not.toHaveBeenCalled();
  });
});

describe('PendingActionsService.reject', () => {
  it('từ chối → REJECTED, không thực thi gì', async () => {
    const { service, repository, ordersService } = setup();
    repository.findById
      .mockResolvedValueOnce(record(PendingActionType.CANCEL_ORDER))
      .mockResolvedValueOnce(record(PendingActionType.CANCEL_ORDER, PendingActionStatus.REJECTED));

    const result = await service.reject(staff, 'pa-1', 'khách đổi ý lại');

    expect(repository.reject).toHaveBeenCalledWith('pa-1', staff.id, 'khách đổi ý lại');
    expect(result.status).toBe(PendingActionStatus.REJECTED);
    expect(ordersService.changeStatus).not.toHaveBeenCalled();
    expect(repository.createReturnRequest).not.toHaveBeenCalled();
  });

  it('đã xử lý → 409', async () => {
    const { service, repository } = setup();
    repository.findById.mockResolvedValue(record(PendingActionType.CANCEL_ORDER));
    repository.reject.mockResolvedValue(false);

    await expect(service.reject(staff, 'pa-1')).rejects.toMatchObject({
      code: 'ACTION_ALREADY_DECIDED',
    });
  });
});

describe('PendingActionsService.list / view', () => {
  it('phân trang và lọc trạng thái', async () => {
    const { service, repository } = setup();
    repository.findPage.mockResolvedValue({
      items: [record(PendingActionType.CANCEL_ORDER)],
      total: 11,
    });

    const page = await service.list({ page: 2, limit: 10, status: PendingActionStatus.PENDING });

    expect(repository.findPage).toHaveBeenCalledWith(PendingActionStatus.PENDING, 10, 10);
    expect(page.meta).toEqual({ page: 2, limit: 10, total: 11, totalPages: 2 });
    expect(page.items[0]).toMatchObject({ orderCode: 'SF-000123', ticketCode: 'TK-000007' });
  });

  it('payload thiếu reason → chuỗi rỗng', () => {
    const view = toPendingActionView({
      ...record(PendingActionType.CANCEL_ORDER),
      payload: {},
      ticket: null,
    });
    expect(view).toMatchObject({ reason: '', ticketCode: null });
  });
});
