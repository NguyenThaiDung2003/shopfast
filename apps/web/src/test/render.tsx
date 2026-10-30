import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from '../components/ui';

function LocationDisplay() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

export interface RenderPageOptions {
  /** URL ban đầu, ví dụ `/san-pham?categoryId=1`; dạng object khi cần `location.state`. */
  route: string | { pathname: string; state: unknown };
  /** Pattern route của trang, ví dụ `/san-pham`. */
  path: string;
}

/** Render một trang với router, TanStack Query (không retry) và Toast như app thật. */
export function renderPage(ui: ReactElement, { route, path }: RenderPageOptions) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={path} element={ui} />
            <Route path="*" element={<p>Trang khác</p>} />
          </Routes>
          <LocationDisplay />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return {
    user,
    queryClient,
    /** pathname + search hiện tại. */
    location: () => screen.getByTestId('location').textContent,
  };
}
