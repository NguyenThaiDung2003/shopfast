import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheStats, HealthReport, QueueStats } from '../system/system-api';
import { apiError, fakeApi, json, loginAs, type FakeHandler } from '../test/fake-api';
import { renderPage } from '../test/render';
import { SystemMonitorPage } from './SystemMonitorPage';

const PATH = '/quan-tri/he-thong';
const CHECKS = {
  database: { status: 'up', latencyMs: 4 },
  redis: { status: 'up', latencyMs: 2 },
} as HealthReport['checks'];
const HEALTH: HealthReport = {
  status: 'ok',
  checks: CHECKS,
  uptimeSeconds: 3_900,
  timestamp: '2024-10-24T07:48:32.000Z',
};
const CACHE: CacheStats = {
  enabled: true,
  namespaces: [
    { name: 'product', hits: 90, misses: 10, hitRate: 0.9 },
    { name: 'product_list', hits: 30, misses: 70, hitRate: 0.3 },
  ],
  total: { name: 'total', hits: 120, misses: 80, hitRate: 0.6 },
};
const queue = (name: string, over: Partial<QueueStats> = {}): QueueStats => ({
  name,
  waiting: 1,
  active: 2,
  delayed: 3,
  completed: 1_500,
  failed: 0,
  ...over,
});
const QUEUES = [
  queue('email'),
  queue('invoice', { failed: 3 }),
  queue('dead-letter', { waiting: 15 }),
];
const VERSION = {
  version: '1.2.3',
  commit: 'abc1234',
  environment: 'production',
  nodeVersion: 'v20.11.0',
};

function setup(routes: Record<string, FakeHandler> = {}, route = PATH) {
  const api = fakeApi({
    'GET /health': () => json(HEALTH),
    'GET /admin/cache/stats': () => json(CACHE),
    'GET /admin/queues/stats': () => json({ queues: QUEUES }),
    'GET /admin/system/version': () => json(VERSION),
    ...routes,
  });
  return { ...renderPage(<SystemMonitorPage />, { route, path: PATH }), api };
}

const service = (name: string) => screen.findByRole('group', { name });
const unavailable = (status: string, checks: HealthReport['checks']) =>
  apiError(503, 'SERVICE_UNAVAILABLE', 'Dịch vụ tạm thời không sẵn sàng.', { status, checks });

describe('SystemMonitorPage', () => {
  beforeEach(() => loginAs('ADMIN'));

  it('hiện dịch vụ, phiên bản, cache và hàng đợi từ API', async () => {
    setup();
    expect(screen.getByRole('status', { name: 'Đang kiểm tra dịch vụ' })).toBeInTheDocument();

    const db = await service('Cơ sở dữ liệu');
    expect(db).toHaveTextContent('Hoạt động');
    expect(db).toHaveTextContent('4ms');
    expect(await service('Redis')).toHaveTextContent('2ms');
    expect(await service('Máy chủ API')).toHaveTextContent('1 giờ 5 phút');
    expect(await screen.findByText('Tất cả hệ thống ổn định')).toBeInTheDocument();
    expect(await screen.findByText('git#abc1234')).toBeInTheDocument();

    expect(await screen.findByTestId('cache-rate')).toHaveTextContent('60%');
    expect(screen.getByText('120 lượt trúng • 80 lượt trượt')).toBeInTheDocument();
    const groups = screen.getByRole('list', { name: 'Theo nhóm cache' });
    expect(within(groups).getByText('Danh sách sản phẩm')).toBeInTheDocument();

    const invoice = (await screen.findByText('invoice')).closest('tr')!;
    expect(invoice).toHaveTextContent('3 lỗi');
    expect(invoice).toHaveTextContent('1.500');
    const dead = screen.getByText('dead-letter').closest('tr')!;
    expect(dead).toHaveTextContent('15 lỗi');
    expect(dead).toHaveClass('bg-error-container/20');
  });

  it('/health 503 → báo đúng thành phần lỗi, không phải lỗi tải trang', async () => {
    setup({
      'GET /health': () =>
        unavailable('error', { ...CHECKS, database: { status: 'down', latencyMs: 1000 } }),
    });
    expect(await service('Cơ sở dữ liệu')).toHaveTextContent('Mất kết nối');
    expect(await service('Redis')).toHaveTextContent('Hoạt động');
    expect(screen.getByText('Hệ thống gặp sự cố')).toBeInTheDocument();
    expect(screen.queryByText('Không kiểm tra được dịch vụ')).not.toBeInTheDocument();
  });

  it('Redis lỗi → degraded: thẻ Redis suy giảm', async () => {
    setup({
      'GET /health': () =>
        json({
          ...HEALTH,
          status: 'degraded',
          checks: { ...CHECKS, redis: { status: 'down', latencyMs: 1000 } },
        }),
    });
    expect(await service('Redis')).toHaveTextContent('Suy giảm');
    expect(screen.getByText('Hệ thống đang suy giảm')).toBeInTheDocument();
  });

  it('mất mạng tới /health → lỗi riêng khối dịch vụ', async () => {
    setup({ 'GET /health': () => apiError(502, 'BAD_GATEWAY', 'Không kết nối được.') });
    expect(await screen.findByText('Không kiểm tra được dịch vụ')).toBeInTheDocument();
    expect(await screen.findByText('invoice')).toBeInTheDocument();
  });

  it('thống kê cache lỗi → chỉ khối cache lỗi, "Thử lại" tải lại', async () => {
    let fail = true;
    const { user } = setup({
      'GET /admin/cache/stats': () =>
        fail ? apiError(503, 'SERVICE_UNAVAILABLE', 'Redis lỗi.') : json(CACHE),
    });
    expect(await screen.findByText('Không tải được thống kê cache')).toBeInTheDocument();
    expect(await service('Cơ sở dữ liệu')).toHaveTextContent('Hoạt động');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByTestId('cache-rate')).toBeInTheDocument();
  });

  it('chưa có lượt đọc; không có hàng đợi', async () => {
    const zero = { name: 'total', hits: 0, misses: 0, hitRate: 0 };
    setup({
      'GET /admin/cache/stats': () => json({ enabled: true, namespaces: [], total: zero }),
      'GET /admin/queues/stats': () => json({ queues: [] }),
    });
    expect(await screen.findByText('Chưa có lượt đọc nào')).toBeInTheDocument();
    expect(await screen.findByText('Chưa có hàng đợi nào')).toBeInTheDocument();
  });

  it('cache đang tắt → thông báo riêng', async () => {
    setup({ 'GET /admin/cache/stats': () => json({ ...CACHE, enabled: false }) });
    expect(await screen.findByText('Cache đang tắt')).toBeInTheDocument();
  });

  it('đặt lại bộ đếm: chỉ DELETE sau khi xác nhận, rồi tải lại số', async () => {
    const del = vi.fn<FakeHandler>(() => json(null, 204));
    const { user, api } = setup({ 'DELETE /admin/cache/stats': del });
    await screen.findByTestId('cache-rate');

    await user.click(screen.getByRole('button', { name: /Đặt lại bộ đếm/ }));
    const dialog = screen.getByRole('dialog', { name: 'Đặt lại bộ đếm cache?' });
    expect(dialog).toHaveTextContent('không bị xoá');
    expect(del).not.toHaveBeenCalled();

    const before = api.to('GET /admin/cache/stats').length;
    await user.click(within(dialog).getByRole('button', { name: 'Đặt lại' }));
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Đã đặt lại bộ đếm cache')).toBeInTheDocument();
    await waitFor(() => expect(api.to('GET /admin/cache/stats').length).toBeGreaterThan(before));
  });

  it('mở Bull Board: mở tab ngay, có cookie phiên rồi mới chuyển trang', async () => {
    const tab = { location: { href: '' }, close: vi.fn() };
    const open = vi.fn(() => tab);
    vi.stubGlobal('open', open);
    const session = vi.fn<FakeHandler>(() => {
      expect(tab.location.href).toBe('');
      return json(null, 204);
    });
    const { user } = setup({ 'POST /admin/queues/session': session });
    await screen.findByText('invoice');

    await user.click(screen.getByRole('button', { name: /Mở bảng điều khiển/ }));
    await waitFor(() => expect(tab.location.href).toBe('/admin/queues'));
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(session).toHaveBeenCalledTimes(1);
  });

  it('mở Bull Board lỗi → đóng tab trống, báo lỗi', async () => {
    const tab = { location: { href: '' }, close: vi.fn() };
    vi.stubGlobal(
      'open',
      vi.fn(() => tab),
    );
    const { user } = setup({
      'POST /admin/queues/session': () => apiError(403, 'FORBIDDEN', 'Không có quyền.'),
    });
    await screen.findByText('invoice');
    await user.click(screen.getByRole('button', { name: /Mở bảng điều khiển/ }));

    expect(await screen.findByText('Không mở được bảng điều khiển')).toBeInTheDocument();
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe('');
  });

  it('đổi chu kỳ làm mới ghi URL; giá trị sai về mặc định', async () => {
    const { user, location } = setup({}, `${PATH}?refresh=7`);
    const select = screen.getByRole('combobox', { name: 'Tự động làm mới' });
    expect(select).toHaveValue('10');
    await user.selectOptions(select, 'off');
    expect(location()).toBe(`${PATH}?refresh=off`);
    await user.selectOptions(select, '10');
    expect(location()).toBe(PATH);
  });
});
