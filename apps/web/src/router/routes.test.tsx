import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Role } from '../auth/roles';
import { ToastProvider } from '../components/ui';
import { fakeApi, loginAs } from '../test/fake-api';
import { routes } from './routes';

const WAREHOUSE_PAGES = ['/quan-tri/kho/don-hang', '/quan-tri/kho/ton-kho'];
const SUPPORT_PAGES = ['/quan-tri/cskh/ticket'];
const ADMIN_PAGES = ['/quan-tri/he-thong'];
const ALL_STAFF_PAGES = [...WAREHOUSE_PAGES, ...SUPPORT_PAGES, ...ADMIN_PAGES];

/** Dựng toàn bộ route thật; API giả trả 404 vì test chỉ quan tâm điều hướng. */
function open(path: string) {
  fakeApi({});
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return router;
}

const forbidden = () => screen.findByRole('heading', { name: /403/ });
const staffMenu = () => screen.findByRole('navigation', { name: 'Điều hướng quản trị' });

describe('phân quyền route', () => {
  it.each([
    ['CUSTOMER', ALL_STAFF_PAGES],
    ['WAREHOUSE', [...SUPPORT_PAGES, ...ADMIN_PAGES]],
    ['SUPPORT', [...WAREHOUSE_PAGES, ...ADMIN_PAGES]],
  ] satisfies Array<[Role, string[]]>)(
    '%s bị 403 ở trang không thuộc vai trò',
    async (role, pages) => {
      for (const page of pages) {
        loginAs(role);
        open(page);
        expect(await forbidden()).toBeInTheDocument();
        document.body.replaceChildren();
      }
    },
  );

  it.each([
    ['WAREHOUSE', WAREHOUSE_PAGES],
    ['SUPPORT', SUPPORT_PAGES],
    ['ADMIN', ALL_STAFF_PAGES],
  ] satisfies Array<[Role, string[]]>)('%s vào được trang của mình', async (role, pages) => {
    for (const page of pages) {
      loginAs(role);
      open(page);
      expect(await staffMenu()).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /403/ })).not.toBeInTheDocument();
      document.body.replaceChildren();
    }
  });

  it.each(ALL_STAFF_PAGES)('chưa đăng nhập vào %s → trang đăng nhập kèm next', async (page) => {
    const router = open(page);
    await screen.findByRole('button', { name: /Đăng nhập ShopFast/ });
    expect(router.state.location.pathname).toBe('/dang-nhap');
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent(page)}`);
  });

  it.each(['/gio-hang', '/don-hang', '/ho-tro'])(
    'nhân viên vào trang khách %s → 403',
    async (page) => {
      loginAs('WAREHOUSE');
      open(page);
      expect(await forbidden()).toBeInTheDocument();
    },
  );

  it('menu chỉ có mục của vai trò: nhân viên không thấy "Giám sát hệ thống"', async () => {
    const labels = async (role: Role, page: string) => {
      loginAs(role);
      open(page);
      const names = within(await staffMenu())
        .getAllByRole('link')
        .map((link) => link.textContent);
      document.body.replaceChildren();
      return names.join('|');
    };
    const monitor = 'Giám sát hệ thống';

    expect(await labels('WAREHOUSE', WAREHOUSE_PAGES[0]!)).not.toContain(monitor);
    expect(await labels('WAREHOUSE', WAREHOUSE_PAGES[0]!)).not.toContain('CSKH');
    expect(await labels('SUPPORT', SUPPORT_PAGES[0]!)).not.toContain(monitor);
    expect(await labels('SUPPORT', SUPPORT_PAGES[0]!)).not.toContain('kho');
    expect(await labels('ADMIN', ADMIN_PAGES[0]!)).toContain(monitor);
  });
});

describe('điều hướng ở trang cửa hàng', () => {
  const header = async () => screen.findByRole('navigation', { name: 'Điều hướng chính' });

  it('khách hàng thấy đơn hàng, hỗ trợ, giỏ hàng; không thấy trang quản trị', async () => {
    loginAs('CUSTOMER');
    open('/');
    const nav = await header();
    expect(within(nav).getByRole('link', { name: 'Đơn hàng của tôi' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Hỗ trợ' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Trang quản trị' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Giỏ hàng/ })).toBeInTheDocument();
  });

  it('nhân viên không thấy link dẫn tới 403, có link về trang quản trị đúng vai trò', async () => {
    loginAs('SUPPORT');
    open('/');
    const nav = await header();
    expect(within(nav).queryByRole('link', { name: 'Đơn hàng của tôi' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Hỗ trợ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Giỏ hàng/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tra cứu đơn hàng' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Trang quản trị' })).toHaveAttribute(
      'href',
      '/quan-tri/cskh/ticket',
    );
  });
});
