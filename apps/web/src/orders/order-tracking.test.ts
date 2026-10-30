import { describe, expect, it } from 'vitest';
import type { OrderDetail } from './my-orders-api';
import { buildTimeline, isOrderId } from './order-tracking';

const ORDER: OrderDetail = {
  id: '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607',
  code: 'SF-000123',
  status: 'SHIPPING',
  totalAmount: 1_000_000,
  paidAt: '2024-10-24T07:36:00.000Z',
  createdAt: '2024-10-24T07:35:00.000Z',
  items: [],
  statusHistory: [
    { from: null, to: 'PENDING_PAYMENT', note: null, changedAt: '2024-10-24T07:35:00.000Z' },
    { from: 'PENDING_PAYMENT', to: 'PAID', note: null, changedAt: '2024-10-24T07:36:00.000Z' },
    { from: 'PAID', to: 'PROCESSING', note: null, changedAt: '2024-10-24T07:50:00.000Z' },
    {
      from: 'PROCESSING',
      to: 'SHIPPING',
      note: 'GHN-123456',
      changedAt: '2024-10-24T08:15:00.000Z',
    },
  ],
};

describe('buildTimeline', () => {
  it('đang giao: 3 chặng xong, chặng 4/5 hiện tại kèm ghi chú, chặng cuối sắp tới', () => {
    const t = buildTimeline(ORDER, 'SHIPPING');
    expect(t.steps.map((s) => [s.status, s.state])).toEqual([
      ['PENDING_PAYMENT', 'done'],
      ['PAID', 'done'],
      ['PROCESSING', 'done'],
      ['SHIPPING', 'current'],
      ['DELIVERED', 'upcoming'],
    ]);
    expect(t.steps[3]).toMatchObject({ at: '2024-10-24T08:15:00.000Z', note: 'GHN-123456' });
    expect(t.steps[4]!.at).toBeUndefined();
    expect(t).toMatchObject({ stepNumber: 4, totalSteps: 5, percent: 75, cancelled: false });
  });

  it('realtime đi trước HTTP: chặng mới là hiện tại nhưng chưa có thời điểm', () => {
    const t = buildTimeline(ORDER, 'DELIVERED');
    expect(t.steps[4]).toMatchObject({ state: 'current', at: undefined });
    expect(t).toMatchObject({ stepNumber: 5, percent: 100 });
  });

  it('lịch sử thiếu bản ghi tạo đơn → dùng createdAt cho chặng đầu', () => {
    const t = buildTimeline(
      { ...ORDER, status: 'PENDING_PAYMENT', statusHistory: [] },
      'PENDING_PAYMENT',
    );
    expect(t.steps[0]).toMatchObject({ state: 'current', at: ORDER.createdAt });
    expect(t.percent).toBe(0);
  });

  it('đã huỷ: các chặng đã đi qua + chặng "Đơn đã bị huỷ", không có chặng sắp tới', () => {
    const cancelled: OrderDetail = {
      ...ORDER,
      status: 'CANCELLED',
      statusHistory: [
        ...ORDER.statusHistory.slice(0, 3),
        {
          from: 'PROCESSING',
          to: 'CANCELLED',
          note: 'Khách yêu cầu',
          changedAt: '2024-10-24T09:00:00.000Z',
        },
      ],
    };
    const t = buildTimeline(cancelled, 'CANCELLED');
    expect(t.steps.map((s) => [s.status, s.state])).toEqual([
      ['PENDING_PAYMENT', 'done'],
      ['PAID', 'done'],
      ['PROCESSING', 'done'],
      ['CANCELLED', 'cancelled'],
    ]);
    expect(t.steps[3]!.note).toBe('Khách yêu cầu');
    expect(t.cancelled).toBe(true);
  });
});

describe('isOrderId', () => {
  it.each([
    [ORDER.id, true],
    ['6F1C2A3B-4D5E-4F60-8A71-B2C3D4E5F607', true],
    ['SF-000123', false],
    ['123', false],
    ['6f1c2a3b-4d5e-0f60-8a71-b2c3d4e5f607', false],
    [undefined, false],
  ])('%s → %s', (value, expected) => {
    expect(isOrderId(value)).toBe(expected);
  });
});
