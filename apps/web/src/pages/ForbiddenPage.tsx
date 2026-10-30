import { Link } from 'react-router-dom';
import { ROLE_HOME, ROLE_LABEL } from '../auth/roles';
import { useSession } from '../auth/useAuth';
import { Card, Icon } from '../components/ui';

/** 403 – đăng nhập rồi nhưng vai trò không được vào trang này. */
export function ForbiddenPage() {
  const session = useSession();
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-space-lg">
      <Card className="w-full max-w-lg p-space-xl text-center">
        <div className="mx-auto mb-space-lg flex h-16 w-16 items-center justify-center rounded-full bg-error-container text-error">
          <Icon name="block" className="text-3xl" />
        </div>
        <p className="text-label-md uppercase tracking-wider text-error">Lỗi 403</p>
        <h1 className="mt-space-xs text-headline-md text-on-surface">
          Bạn không có quyền truy cập
        </h1>
        <p className="mt-space-sm text-body-md text-on-surface-variant">
          Trang này không dành cho tài khoản{' '}
          {session ? <strong>{ROLE_LABEL[session.user.role]}</strong> : 'của bạn'}. Nếu cần quyền,
          hãy liên hệ quản trị viên.
        </p>
        <Link
          to={session ? ROLE_HOME[session.user.role] : '/'}
          className="mt-space-xl inline-flex h-10 items-center gap-space-sm rounded-lg bg-primary-container px-space-lg text-title-sm text-on-primary transition-colors hover:bg-primary"
        >
          <Icon name="home" className="text-lg" />
          Về trang của tôi
        </Link>
      </Card>
    </div>
  );
}
