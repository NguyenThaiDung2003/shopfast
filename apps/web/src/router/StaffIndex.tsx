import { Navigate } from 'react-router-dom';
import { useSession } from '../auth/useAuth';
import { staffNavFor } from './staff-nav';

/** `/quan-tri` → trang đầu tiên vai trò được vào. */
export function StaffIndex() {
  const session = useSession();
  const first = session ? staffNavFor(session.user.role)[0] : undefined;
  return <Navigate to={first ? `/quan-tri/${first.path}` : '/'} replace />;
}
