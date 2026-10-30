import { lazy, Suspense } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { STAFF_ROLES } from '../auth/roles';
import { LoadingBlock } from '../components/ui';
import { AuthLayout } from '../layouts/AuthLayout';
import { CustomerLayout } from '../layouts/CustomerLayout';
import type { RouteHandle } from '../layouts/StaffLayout';
import { CartPage } from '../pages/CartPage';
import { CheckoutPage } from '../pages/CheckoutPage';
import { HomePage } from '../pages/HomePage';
import { LoginPage } from '../pages/LoginPage';
import { MyOrdersPage } from '../pages/MyOrdersPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { OrderSuccessPage } from '../pages/OrderSuccessPage';
import { OtpVerifyPage } from '../pages/OtpVerifyPage';
import { ProductDetailPage } from '../pages/ProductDetailPage';
import { ProductListPage } from '../pages/ProductListPage';
import { SupportPage } from '../pages/SupportPage';
import { SystemErrorPage } from '../pages/SystemErrorPage';
import { RequireAuth } from './RequireAuth';
import { RootLayout } from './RootLayout';
import { STAFF_NAV } from './staff-nav';
import { StaffIndex } from './StaffIndex';

// Tách chunk: khách không phải tải mã nhân viên. Các lazy này luôn nằm TRONG RequireAuth nên người
// không có quyền không tải chunk; lỗi tải chunk (vừa deploy bản mới) rơi vào `errorElement`.
const StaffLayout = lazy(() =>
  import('../layouts/StaffLayout').then((m) => ({ default: m.StaffLayout })),
);
const WarehouseOrdersPage = lazy(() =>
  import('../pages/WarehouseOrdersPage').then((m) => ({ default: m.WarehouseOrdersPage })),
);
const InventoryPage = lazy(() =>
  import('../pages/InventoryPage').then((m) => ({ default: m.InventoryPage })),
);
const SupportConsolePage = lazy(() =>
  import('../pages/SupportConsolePage').then((m) => ({ default: m.SupportConsolePage })),
);
const SystemMonitorPage = lazy(() =>
  import('../pages/SystemMonitorPage').then((m) => ({ default: m.SystemMonitorPage })),
);
// Riêng trang này dùng socket.io-client, thư viện lớn nhất của bundle.
const OrderTrackingPage = lazy(() =>
  import('../pages/OrderTrackingPage').then((m) => ({ default: m.OrderTrackingPage })),
);

const STAFF_PAGES: Record<string, JSX.Element> = {
  'kho/don-hang': <WarehouseOrdersPage />,
  'kho/ton-kho': <InventoryPage />,
  'cskh/ticket': <SupportConsolePage />,
  'he-thong': <SystemMonitorPage />,
};

const suspended = (element: JSX.Element): JSX.Element => (
  <Suspense fallback={<LoadingBlock />}>{element}</Suspense>
);

const customerOnly = (element: JSX.Element): JSX.Element => (
  <RequireAuth roles={['CUSTOMER']}>{element}</RequireAuth>
);

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: (
      <div className="min-h-screen bg-background p-margin-mobile md:p-margin">
        <SystemErrorPage />
      </div>
    ),
    children: [
      {
        element: <CustomerLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'san-pham', element: <ProductListPage /> },
          { path: 'san-pham/:id', element: <ProductDetailPage /> },
          {
            path: 'gio-hang',
            element: customerOnly(<CartPage />),
          },
          {
            path: 'thanh-toan',
            element: customerOnly(<CheckoutPage />),
          },
          { path: 'dat-hang-thanh-cong/:id', element: customerOnly(<OrderSuccessPage />) },
          { path: 'don-hang', element: customerOnly(<MyOrdersPage />) },
          { path: 'don-hang/:id', element: customerOnly(suspended(<OrderTrackingPage />)) },
          { path: 'ho-tro', element: customerOnly(<SupportPage />) },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
      {
        element: <AuthLayout />,
        children: [
          { path: 'dang-nhap', element: <LoginPage /> },
          { path: 'xac-minh-otp', element: <OtpVerifyPage /> },
          { path: 'loi-he-thong', element: <SystemErrorPage /> },
        ],
      },
      {
        path: 'quan-tri',
        element: <RequireAuth roles={STAFF_ROLES}>{suspended(<StaffLayout />)}</RequireAuth>,
        children: [
          { index: true, element: <StaffIndex /> },
          ...STAFF_NAV.map((item): RouteObject => ({
            path: item.path,
            handle: { title: item.label } satisfies RouteHandle,
            element: (
              <RequireAuth roles={item.roles}>{suspended(STAFF_PAGES[item.path]!)}</RequireAuth>
            ),
          })),
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
