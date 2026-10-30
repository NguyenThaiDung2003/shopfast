import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Role } from '../auth/roles';
import { useSession } from '../auth/useAuth';
import { ForbiddenPage } from '../pages/ForbiddenPage';

export interface RequireAuthProps {
  /** Vai trò được vào; bỏ trống = mọi người đã đăng nhập. */
  roles?: readonly Role[];
  children: ReactNode;
}

/**
 * Guard điều hướng theo JWT phía client. Chỉ để UX – quyền thật do API kiểm (ADR-0003),
 * nên sửa token trong trình duyệt cũng không lấy được dữ liệu của vai trò khác.
 */
export function RequireAuth({ roles, children }: RequireAuthProps) {
  const session = useSession();
  const location = useLocation();

  if (!session) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/dang-nhap?next=${encodeURIComponent(next)}`} replace />;
  }
  if (roles && !roles.includes(session.user.role)) {
    return <ForbiddenPage requiredRoles={roles} />;
  }
  return <>{children}</>;
}
