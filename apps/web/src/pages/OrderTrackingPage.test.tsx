import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderDetail } from '../orders/my-orders-api';
import { sessionStore } from '../auth/session';
import { apiError, fakeApi, json, loginAs, type FakeHandler } from '../test/fake-api';
import { renderPage } from '../test/render';
import { OrderTrackingPage } from './OrderTrackingPage';

// Socket.IO giả: hook useOrderTracking thật vẫn chạy, test điều khiển kết nối và sự kiện.
const sockets = vi.hoisted(() => {
  type Fn = (...args: never[]) => void;
  class FakeSocketClient {
    static instances: FakeSocketClient[] = [];
    readonly tracked = new Set<string>();
    closed = false;
    private readonly listeners = {
      update: new Set<Fn>(),
      snapshot: new Set<Fn>(),
      state: new Set<Fn>(),
      error: new Set<Fn>(),
    };
    constructor(readonly options: { getAccessToken: () => unknown }) {
      FakeSocketClient.instances.push(this);
    }
    track(id: string) {
      this.tracked.add(id);
    }
    untrack(id: string) {
      this.tracked.delete(id);
    }
    private on(kind: keyof FakeSocketClient['listeners'], fn: Fn) {
      this.listeners[kind].add(fn);
      return () => this.listeners[kind].delete(fn);
    }
    onUpdate(fn: Fn) {
      return this.on('update', fn);
    }
    onSnapshot(fn: Fn) {
      return this.on('snapshot', fn);
    }
    onStateChange(fn: Fn) {
      return this.on('state', fn);
    }
    onError(fn: Fn) {
      return this.on('error', fn);
    }
    close() {
      this.closed = true;
    }
    emit(kind: keyof FakeSocketClient['listeners'], ...args: unknown[]) {
      this.listeners[kind].forEach((fn) => (fn as (...a: unknown[]) => void)(...args));
    }
  }
  return { FakeSocketClient };
});

vi.mock('../realtime/order-socket', () => ({ OrderSocketClient: sockets.FakeSocketClient }));

const ID = '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607';

function detail(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: ID,
    code: 'SF-000123',
    status: 'SHIPPING',
    totalAmount: 10_760_000,
    paidAt: '2024-10-24T07:36:00.000Z',
    createdAt: '2024-10-24T07:35:00.000Z',
    items: [
      {
        productId: 1,
        sku: 'SF-1',
        name: 'Tai nghe AirPods Pro 2',
        quantity: 1,
        unitPrice: 5_490_000,
        lineTotal: 5_490_000,
      },
      {
        productId: 2,
        sku: 'SF-2',
        name: 'Đồng hồ Galaxy Watch 6',
        quantity: 1,
        unitPrice: 4_190_000,
        lineTotal: 4_190_000,
      },
      {
        productId: 3,
        sku: 'SF-3',
        name: 'Củ sạc Anker 65W',
        quantity: 2,
        unitPrice: 540_000,
        lineTotal: 1_080_000,
      },
    ],
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
    ...overrides,
  };
}

const DELIVERED = detail({
  status: 'DELIVERED',
  statusHistory: [
    ...detail().statusHistory,
    { from: 'SHIPPING', to: 'DELIVERED', note: null, changedAt: '2024-10-24T09:05:00.000Z' },
  ],
});

function setup(route = `/don-hang/${ID}`, handler: FakeHandler = () => json(detail())) {
  const api = fakeApi({ [`GET /orders/${ID}`]: handler });
  const view = renderPage(<OrderTrackingPage />, { route, path: '/don-hang/:id' });
  return { ...view, api };
}

const socket = () => sockets.FakeSocketClient.instances.at(-1)!;
const step = (title: string) =>
  screen.getByRole('heading', { name: new RegExp(title) }).closest('li') as HTMLElement;

describe('OrderTrackingPage', () => {
  beforeEach(() => {
    sockets.FakeSocketClient.instances.length = 0;
    loginAs('CUSTOMER');
  });
  afterEach(() => {
    sockets.FakeSocketClient.instances.length = 0;
  });

  it('skeleton rồi chi tiết: mã đơn, thời gian, chặng 4/5, lịch trình, kiện hàng, thanh toán', async () => {
    const { api } = setup();
    expect(screen.getByRole('status', { name: 'Đang tải đơn hàng' })).toBeInTheDocument();

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Theo dõi đơn hàng #SF-000123',
    );
    expect(api.to(`GET /orders/${ID}`)).toHaveLength(1);
    expect(screen.getByText('Đặt lúc: 14:35 24/10/2024')).toBeInTheDocument();
    expect(screen.getByTestId('current-status')).toHaveTextContent('Đang giao');
    expect(screen.getByText('Chặng 4/5: Đang giao')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Tiến độ đơn hàng' })).toHaveAttribute(
      'aria-valuenow',
      '75',
    );

    expect(step('Kho đang xử lý')).toHaveAttribute('data-state', 'done');
    expect(within(step('Kho đang xử lý')).getByText('14:50 24/10/2024')).toBeInTheDocument();
    const current = step('Đang giao hàng');
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(within(current).getByText('Hiện tại')).toBeInTheDocument();
    expect(within(current).getByText('GHN-123456')).toBeInTheDocument();
    expect(within(step('Đã giao thành công')).getByText('Chưa tới')).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Kiện hàng gồm 4 sản phẩm' })).toBeInTheDocument();
    expect(screen.getByTestId('order-total').textContent).toBe('10.760.000 ₫');
    // "Đã thanh toán" cũng là tên một chặng → tìm trong cột thông tin.
    const info = screen.getByRole('complementary', { name: 'Thông tin đơn hàng' });
    expect(within(info).getByText('Đã thanh toán')).toBeInTheDocument();

    // Đăng ký theo dõi realtime đúng đơn, token lấy từ phiên hiện tại.
    // Hook đăng ký sau một lượt render (khi state `client` đã có).
    await waitFor(() => expect(socket().tracked.has(ID)).toBe(true));
    await expect(socket().options.getAccessToken()).resolves.toBe(
      sessionStore.getSnapshot()!.accessToken,
    );
  });

  it('chỉ báo kết nối: đang kết nối → trực tiếp → mất kết nối (tự thử lại) → lỗi theo dõi', async () => {
    setup();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText('Đang kết nối…')).toBeInTheDocument();

    act(() => socket().emit('state', 'connected'));
    expect(screen.getByText('Đang cập nhật trực tiếp')).toBeInTheDocument();

    act(() => socket().emit('state', 'reconnecting'));
    expect(screen.getByText('Mất kết nối, đang thử lại…')).toBeInTheDocument();

    act(() => socket().emit('state', 'connected'));
    expect(screen.getByText('Đang cập nhật trực tiếp')).toBeInTheDocument();

    act(() =>
      socket().emit('error', { code: 'ORDER_NOT_FOUND', message: 'Không tìm thấy đơn hàng.' }, ID),
    );
    expect(screen.getByText('Không nhận được cập nhật trực tiếp')).toBeInTheDocument();
  });

  it('order:updated → đổi trạng thái ngay, toast, tải lại lịch sử để có thời điểm chặng mới', async () => {
    let current = detail();
    const { api } = setup(undefined, () => json(current));
    await screen.findByRole('heading', { level: 1 });
    act(() => socket().emit('state', 'connected'));
    act(() => socket().emit('snapshot', { id: ID, code: 'SF-000123', status: 'SHIPPING' }));
    expect(screen.queryByText('Cập nhật đơn hàng')).not.toBeInTheDocument();

    current = DELIVERED;
    act(() =>
      socket().emit('update', {
        orderId: ID,
        code: 'SF-000123',
        from: 'SHIPPING',
        to: 'DELIVERED',
        occurredAt: '2024-10-24T09:05:00.000Z',
      }),
    );

    expect(screen.getByTestId('current-status')).toHaveTextContent('Đã giao');
    expect(screen.getByText('Cập nhật đơn hàng')).toBeInTheDocument();
    expect(screen.getByText('Đơn SF-000123 đã chuyển sang Đã giao.')).toBeInTheDocument();
    await waitFor(() => expect(api.to(`GET /orders/${ID}`)).toHaveLength(2));
    expect(
      await within(step('Đã giao thành công')).findByText('16:05 24/10/2024'),
    ).toBeInTheDocument();
  });

  it('nối lại sau khi mất mạng: snapshot mang trạng thái mới → vẫn báo toast', async () => {
    setup();
    await screen.findByRole('heading', { level: 1 });
    act(() => socket().emit('state', 'reconnecting'));
    act(() => socket().emit('state', 'connected'));
    act(() => socket().emit('snapshot', { id: ID, code: 'SF-000123', status: 'CANCELLED' }));

    expect(screen.getByText('Đơn SF-000123 đã chuyển sang Đã huỷ.')).toBeInTheDocument();
    expect(screen.getByText('Đơn đã huỷ')).toBeInTheDocument();
    expect(step('Đơn đã bị huỷ')).toHaveAttribute('data-state', 'cancelled');
  });

  it('đơn đã huỷ: lịch trình dừng ở chặng huỷ kèm ghi chú', async () => {
    setup(undefined, () =>
      json(
        detail({
          status: 'CANCELLED',
          paidAt: null,
          statusHistory: [
            {
              from: null,
              to: 'PENDING_PAYMENT',
              note: null,
              changedAt: '2024-10-24T07:35:00.000Z',
            },
            {
              from: 'PENDING_PAYMENT',
              to: 'CANCELLED',
              note: 'Khách yêu cầu huỷ',
              changedAt: '2024-10-24T08:00:00.000Z',
            },
          ],
        }),
      ),
    );
    await screen.findByRole('heading', { level: 1 });
    expect(within(step('Đơn đã bị huỷ')).getByText('Khách yêu cầu huỷ')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Đã giao thành công/ })).not.toBeInTheDocument();
    expect(screen.getByText('Chưa thanh toán')).toBeInTheDocument();
  });

  it('id không phải UUID → không tìm thấy, không gọi API, không mở socket', async () => {
    const { api } = setup('/don-hang/SF-000123');
    expect(await screen.findByText('Không tìm thấy đơn hàng')).toBeInTheDocument();
    expect(api.requests).toHaveLength(0);
    expect(sockets.FakeSocketClient.instances).toHaveLength(0);
  });

  it('API 404 (đơn của người khác) → không tìm thấy', async () => {
    setup(undefined, () => apiError(404, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng.'));
    expect(await screen.findByText('Không tìm thấy đơn hàng')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Về đơn hàng của tôi/ })).toHaveAttribute(
      'href',
      '/don-hang',
    );
  });

  it('lỗi server → thông điệp + "Thử lại"', async () => {
    let fail = true;
    const { user } = setup(undefined, () =>
      fail ? apiError(503, 'SERVICE_UNAVAILABLE', 'Hệ thống đang bận.') : json(detail()),
    );
    expect(await screen.findByText('Hệ thống đang bận.')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('#SF-000123');
  });

  it('sao chép mã đơn → clipboard + toast', async () => {
    const { user } = setup();
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('button', { name: 'Sao chép mã đơn' }));
    await expect(navigator.clipboard.readText()).resolves.toBe('SF-000123');
    expect(screen.getByText('Đã sao chép mã đơn')).toBeInTheDocument();
  });

  it('rời trang → đóng socket', async () => {
    setup();
    await screen.findByRole('heading', { level: 1 });
    const client = socket();
    cleanup();
    expect(client.closed).toBe(true);
  });
});
