import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { STAFF_ROLES } from '../auth/roles';
import { AuthLayout } from '../layouts/AuthLayout';
import { CustomerLayout } from '../layouts/CustomerLayout';
import { StaffLayout, type RouteHandle } from '../layouts/StaffLayout';
import { LoginPage } from '../pages/LoginPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { RequireAuth } from './RequireAuth';
import { RootLayout } from './RootLayout';
import { STAFF_NAV } from './staff-nav';
import { StaffIndex } from './StaffIndex';

const customerOnly = (element: JSX.Element): JSX.Element => (
  <RequireAuth roles={['CUSTOMER']}>{element}</RequireAuth>
);

const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      {
        element: <CustomerLayout />,
        children: [
          { index: true, element: <PlaceholderPage title="Trang chủ" icon="storefront" /> },
          { path: 'san-pham', element: <PlaceholderPage title="Sản phẩm" icon="grid_view" /> },
          {
            path: 'san-pham/:id',
            element: <PlaceholderPage title="Chi tiết sản phẩm" icon="inventory_2" />,
          },
          {
            path: 'gio-hang',
            element: customerOnly(<PlaceholderPage title="Giỏ hàng" icon="shopping_cart" />),
          },
          {
            path: 'thanh-toan',
            element: customerOnly(
              <PlaceholderPage title="Thanh toán và đặt hàng" icon="payments" />,
            ),
          },
          {
            path: 'don-hang',
            element: customerOnly(<PlaceholderPage title="Đơn hàng của tôi" icon="package_2" />),
          },
          {
            path: 'don-hang/:id',
            element: customerOnly(
              <PlaceholderPage title="Theo dõi đơn hàng" icon="local_shipping" />,
            ),
          },
          {
            path: 'ho-tro',
            element: customerOnly(
              <PlaceholderPage title="Hỗ trợ khách hàng" icon="support_agent" />,
            ),
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
      {
        element: <AuthLayout />,
        children: [{ path: 'dang-nhap', element: <LoginPage /> }],
      },
      {
        path: 'quan-tri',
        element: (
          <RequireAuth roles={STAFF_ROLES}>
            <StaffLayout />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <StaffIndex /> },
          ...STAFF_NAV.map((item): RouteObject => ({
            path: item.path,
            handle: { title: item.label } satisfies RouteHandle,
            element: (
              <RequireAuth roles={item.roles}>
                <PlaceholderPage title={item.label} icon={item.icon} />
              </RequireAuth>
            ),
          })),
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
