import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '../router/RequireAuth';
import { apiError, fakeApi, json, loginAs, type FakeHandler } from '../test/fake-api';
import { renderPage } from '../test/render';
import { SystemErrorPage } from './SystemErrorPage';

const HEALTH = {
  status: 'degraded',
  checks: { database: { status: 'up', latencyMs: 2 }, redis: { status: 'down', latencyMs: 900 } },
  uptimeSeconds: 10,
  timestamp: '2024-10-24T07:42:08.000Z',
};

function Boom(): JSX.Element {
  throw new Error('secret-db-host:5432 exploded');
}

function renderCrash(health: FakeHandler) {
  fakeApi({ 'GET /health': health });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const router = createMemoryRouter([
    { path: '/', element: <Boom />, errorElement: <SystemErrorPage /> },
  ]);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('SystemErrorPage', () => {
  it('lỗi render → trang 500, tình trạng thật từ /health, không lộ chi tiết lỗi', async () => {
    renderCrash(() => json(HEALTH));
    expect(screen.getByRole('heading', { name: /500 Lỗi hệ thống/ })).toBeInTheDocument();
    const status = await screen.findByRole('region', { name: 'Tình trạng dịch vụ' });
    expect(status).toHaveTextContent('Cơ sở dữ liệu');
    expect(status).toHaveTextContent('Suy giảm');
    expect(document.body).not.toHaveTextContent('secret-db-host');
    expect(screen.getByRole('button', { name: /Thử tải lại trang/ })).toBeInTheDocument();
  });

  it('/health cũng lỗi → ẩn tình trạng, trang vẫn hiện', async () => {
    const seen = vi.fn(() => apiError(502, 'BAD_GATEWAY', 'Lỗi.'));
    renderCrash(seen);
    await waitFor(() => expect(seen).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: /500 Lỗi hệ thống/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Tình trạng dịch vụ' })).not.toBeInTheDocument();
  });
});

describe('ForbiddenPage (qua RequireAuth)', () => {
  beforeEach(() => loginAs('CUSTOMER'));

  function setup() {
    const api = fakeApi({
      'GET /auth/me': () =>
        json({
          id: 'u',
          email: 'minh@email.vn',
          fullName: 'Minh',
          role: 'CUSTOMER',
          createdAt: '',
        }),
      'POST /auth/logout': () => json(null, 204),
    });
    const view = renderPage(
      <RequireAuth roles={['WAREHOUSE', 'ADMIN']}>
        <p>Trang kho</p>
      </RequireAuth>,
      { route: '/quan-tri/kho/don-hang?page=2', path: '/quan-tri/kho/don-hang' },
    );
    return { ...view, api };
  }

  it('sai vai trò → 403 với tài khoản, vai trò thật và vai trò được phép', async () => {
    setup();
    expect(screen.queryByText('Trang kho')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /403 Không có quyền truy cập/ }),
    ).toBeInTheDocument();
    expect(await screen.findByText('minh@email.vn')).toBeInTheDocument();
    expect(screen.getByText('Vai trò: Khách hàng')).toBeInTheDocument();
    expect(screen.getByText('Kho & Vận hành, Quản trị hệ thống')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Về trang của tôi/ })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /Báo cáo nhầm lẫn/ })).toHaveAttribute(
      'href',
      '/ho-tro',
    );
  });

  it('"Đổi tài khoản khác" → đăng xuất rồi sang đăng nhập, giữ trang đang vào', async () => {
    const { user, api, location } = setup();
    await user.click(screen.getByRole('button', { name: /Đổi tài khoản khác/ }));
    await waitFor(() => expect(api.to('POST /auth/logout')).toHaveLength(1));
    await waitFor(() =>
      expect(location()).toContain(
        `/dang-nhap?next=${encodeURIComponent('/quan-tri/kho/don-hang?page=2')}`,
      ),
    );
  });
});
