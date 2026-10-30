import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderDetail } from '../orders/my-orders-api';
import { apiError, fakeApi, json, loginAs, type FakeHandler } from '../test/fake-api';
import { renderPage } from '../test/render';
import { OrderSuccessPage } from './OrderSuccessPage';

const ID = '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607';
const ORDER: OrderDetail = {
  id: ID,
  code: 'SF-000123',
  status: 'PENDING_PAYMENT',
  totalAmount: 5_500_000,
  paidAt: null,
  createdAt: '2024-10-24T07:35:00.000Z',
  items: [
    {
      productId: 1,
      sku: 'SF-1',
      name: 'AirPods Pro 2',
      quantity: 2,
      unitPrice: 1,
      lineTotal: 5_000_000,
    },
    { productId: 2, sku: 'SF-2', name: 'Cáp Anker', quantity: 1, unitPrice: 1, lineTotal: 500_000 },
  ],
  statusHistory: [],
  shipping: {
    recipientName: 'Nguyễn Văn Minh',
    phone: '0912345678',
    address: '123 Lê Lợi, Quận 1, TP. Hồ Chí Minh',
    note: 'Gọi trước khi đến',
  },
};

function setup(handler: FakeHandler = () => json(ORDER), id = ID) {
  const api = fakeApi({ [`GET /orders/${id}`]: handler });
  const view = renderPage(<OrderSuccessPage />, {
    route: `/dat-hang-thanh-cong/${id}`,
    path: '/dat-hang-thanh-cong/:id',
  });
  return { ...view, api };
}

describe('OrderSuccessPage', () => {
  beforeEach(() => loginAs('CUSTOMER'));

  it('hiện đúng đơn: mã, người nhận, sản phẩm, tổng, các link tiếp theo', async () => {
    setup();
    expect(screen.getByRole('status', { name: 'Đang tải đơn hàng' })).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Đặt hàng thành công!' }),
    ).toBeInTheDocument();
    expect(screen.getByText('#SF-000123')).toBeInTheDocument();
    const recipient = screen.getByRole('region', { name: 'Người nhận hàng' });
    expect(recipient).toHaveTextContent('Nguyễn Văn Minh (0912345678)');
    expect(recipient).toHaveTextContent('123 Lê Lợi');
    expect(recipient).toHaveTextContent('Gọi trước khi đến');
    expect(screen.getByText('Sản phẩm đã đặt (3 món)')).toBeInTheDocument();
    expect(screen.getByText('AirPods Pro 2')).toBeInTheDocument();
    expect(screen.getByTestId('order-total')).toHaveTextContent('5.500.000');
    expect(screen.getByRole('link', { name: /Theo dõi tiến độ/ })).toHaveAttribute(
      'href',
      `/don-hang/${ID}`,
    );
    expect(screen.getByRole('link', { name: /Cần hỗ trợ/ })).toHaveAttribute(
      'href',
      `/ho-tro?don=${ID}`,
    );
    const steps = screen.getByRole('list', { name: 'Các bước đặt hàng' });
    expect(within(steps).queryByRole('listitem', { current: 'step' })).not.toBeInTheDocument();
  });

  it('đơn cũ không có thông tin nhận hàng → ẩn thẻ người nhận', async () => {
    setup(() => json({ ...ORDER, shipping: null }));
    await screen.findByRole('heading', { name: 'Đặt hàng thành công!' });
    expect(screen.queryByRole('region', { name: 'Người nhận hàng' })).not.toBeInTheDocument();
  });

  it('id sai → không gọi API', async () => {
    const bad = setup(undefined, 'abc');
    expect(screen.getByText('Không tìm thấy đơn hàng')).toBeInTheDocument();
    expect(bad.api.requests).toHaveLength(0);
  });

  it('404 → không tìm thấy đơn', async () => {
    setup(() => apiError(404, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng.'));
    expect(await screen.findByText('Không tìm thấy đơn hàng')).toBeInTheDocument();
  });

  it('503 → "Thử lại" tải lại đơn', async () => {
    let fail = true;
    const { user } = setup(() =>
      fail ? apiError(503, 'SERVICE_UNAVAILABLE', 'Hệ thống bận.') : json(ORDER),
    );
    expect(await screen.findByText('Không tải được đơn hàng')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('#SF-000123')).toBeInTheDocument();
  });

  it('sao chép mã đơn', async () => {
    const { user } = setup();
    await screen.findByText('#SF-000123');
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    await user.click(screen.getByRole('button', { name: /Sao chép/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('SF-000123'));
    expect(await screen.findByText('Đã sao chép mã đơn hàng')).toBeInTheDocument();
  });
});
