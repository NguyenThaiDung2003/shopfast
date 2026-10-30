import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_HOME, ROLE_LABEL, type Role } from '../auth/roles';
import { useLogout, useMe, useSession } from '../auth/useAuth';
import { Badge, Button, Card, Icon } from '../components/ui';

/** 403 – đăng nhập rồi nhưng vai trò không được vào trang này (thiết kế loi-403-va-su-co-he-thong). */
export function ForbiddenPage({ requiredRoles }: { requiredRoles?: readonly Role[] }) {
  const session = useSession();
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();

  const switchAccount = () => {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    logout.mutate(undefined, { onSettled: () => navigate(`/dang-nhap?next=${next}`) });
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-space-md">
      <Card className="w-full max-w-3xl space-y-space-lg p-space-lg text-center md:p-space-xl">
        <span className="mx-auto flex h-24 w-24 items-center justify-center rounded-xl bg-surface-container-low text-primary">
          <Icon name="admin_panel_settings" className="text-5xl" />
        </span>
        <div className="space-y-space-xs">
          <Badge tone="neutral" icon="gpp_bad" pill>
            Mã trạng thái HTTP 403: Quyền truy cập bị từ chối
          </Badge>
          <h1 className="text-headline-lg-mobile text-on-surface md:text-display-hero">
            <span className="text-primary">403</span> Không có quyền truy cập
          </h1>
          <p className="text-headline-sm text-on-surface">Bạn không có quyền truy cập trang này</p>
        </div>

        <dl className="grid gap-space-sm rounded-lg bg-surface-container-low p-space-md text-left sm:grid-cols-2">
          <div className="rounded-lg bg-surface-container-lowest p-space-md">
            <dt className="text-body-sm text-on-surface-variant">Tài khoản đăng nhập</dt>
            <dd className="break-words text-title-md text-on-surface">
              {me.data?.email ?? 'Đang tải…'}
            </dd>
            {session && (
              <dd className="text-body-sm text-tertiary-container">
                Vai trò: {ROLE_LABEL[session.user.role]}
              </dd>
            )}
          </div>
          {requiredRoles && (
            <div className="rounded-lg bg-surface-container-lowest p-space-md">
              <dt className="text-body-sm text-on-surface-variant">Vai trò được phép</dt>
              <dd className="text-title-md text-primary">
                {requiredRoles.map((role) => ROLE_LABEL[role]).join(', ')}
              </dd>
            </div>
          )}
        </dl>

        <div className="grid gap-space-sm sm:grid-cols-2">
          <Link
            to={session ? ROLE_HOME[session.user.role] : '/'}
            className="flex h-12 items-center justify-center gap-space-sm rounded-lg bg-secondary-container text-title-md text-on-secondary hover:bg-secondary"
          >
            <Icon name="home" className="text-lg" />
            Về trang của tôi
          </Link>
          <Button
            size="lg"
            variant="tonal"
            icon="switch_account"
            loading={logout.isPending}
            onClick={switchAccount}
          >
            Đổi tài khoản khác
          </Button>
        </div>

        {session?.user.role === 'CUSTOMER' && (
          <Link
            to="/ho-tro"
            className="inline-flex items-center gap-space-xs text-title-sm text-primary underline"
          >
            <Icon name="contact_support" className="text-lg" />
            Báo cáo nhầm lẫn quyền hạn
          </Link>
        )}
      </Card>
    </div>
  );
}
