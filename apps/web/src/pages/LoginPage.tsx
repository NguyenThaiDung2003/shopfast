import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { isApiError } from '../api/errors';
import { ROLE_HOME, type Role } from '../auth/roles';
import { useLogin, useSession } from '../auth/useAuth';
import { RateLimitBanner } from '../components/RateLimitBanner';
import { Button, Card, Icon, Input } from '../components/ui';

/** Chỉ cho quay lại đường dẫn nội bộ, đúng khu vực của vai trò (chống open redirect). */
function redirectTarget(next: string | null, role: Role): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return ROLE_HOME[role];
  if (role === 'CUSTOMER' && next.startsWith('/quan-tri')) return ROLE_HOME[role];
  return next;
}

interface FieldErrors {
  email?: string;
  password?: string;
}

export function LoginPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  if (session && !login.isPending) {
    return <Navigate to={redirectTarget(params.get('next'), session.user.role)} replace />;
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const errors: FieldErrors = {};
    if (!email.trim()) errors.email = 'Vui lòng nhập email.';
    if (!password) errors.password = 'Vui lòng nhập mật khẩu.';
    setFieldErrors(errors);
    if (errors.email || errors.password) return;

    login.mutate(
      { email: email.trim(), password },
      {
        onSuccess: (result) =>
          navigate(redirectTarget(params.get('next'), result.user.role), { replace: true }),
      },
    );
  };

  // 429 hiện ở banner đếm ngược; lỗi khác hiện ngay trên form.
  const formError =
    login.error && !(isApiError(login.error) && login.error.status === 429)
      ? isApiError(login.error)
        ? login.error.message
        : 'Đã có lỗi xảy ra, vui lòng thử lại sau.'
      : null;

  return (
    <div className="grid items-stretch gap-space-xl lg:grid-cols-2">
      <section className="relative hidden overflow-hidden rounded-xl bg-gradient-to-br from-primary via-primary-container to-surface-tint p-space-xl text-on-primary shadow-card lg:flex lg:flex-col lg:justify-center">
        <h1 className="text-display-hero">
          Chào mừng trở lại với <span className="text-secondary-fixed-dim">ShopFast</span>
        </h1>
        <p className="mt-space-md max-w-md text-body-lg text-primary-fixed">
          Đăng nhập để theo dõi đơn hàng, quản lý giỏ hàng và nhận hỗ trợ nhanh.
        </p>
      </section>

      <Card className="p-space-xl md:p-10">
        <h2 className="text-headline-lg-mobile text-on-surface md:text-headline-lg">
          Đăng nhập tài khoản
        </h2>
        <p className="mt-space-xs text-body-md text-on-surface-variant">
          Nhập email và mật khẩu để tiếp tục.
        </p>

        <RateLimitBanner className="mt-space-lg" />

        {formError && (
          <div
            role="alert"
            className="mt-space-lg flex items-start gap-space-sm rounded-lg bg-error-container p-space-md text-body-md text-on-error-container"
          >
            <Icon name="error" className="text-lg" />
            {formError}
          </div>
        )}

        <form onSubmit={onSubmit} noValidate className="mt-space-xl space-y-space-lg">
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            icon="alternate_email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={fieldErrors.email}
            required
          />
          <Input
            label="Mật khẩu"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            icon="lock"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldErrors.password}
            required
            trailing={
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                className="rounded p-space-xs text-outline transition-colors hover:text-on-surface"
              >
                <Icon name={showPassword ? 'visibility' : 'visibility_off'} />
              </button>
            }
          />
          <Button
            type="submit"
            size="lg"
            fullWidth
            loading={login.isPending}
            iconRight="arrow_forward"
          >
            Đăng nhập
          </Button>
        </form>
      </Card>
    </div>
  );
}
