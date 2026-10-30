import { useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { isApiError } from '../api/errors';
import { rateLimitStore } from '../api/rate-limit';
import { isEmailFormat, validateLogin, type LoginErrors } from '../auth/login-form';
import { ROLE_HOME, type Role } from '../auth/roles';
import { useLogin, useSession } from '../auth/useAuth';
import { Breadcrumb } from '../components/Breadcrumb';
import { RateLimitBanner } from '../components/RateLimitBanner';
import { Button, Card, Icon, Input } from '../components/ui';
import { supportContacts } from '../support/support-contacts';

const HOTLINE = supportContacts(import.meta.env).find((contact) => contact.key === 'hotline');

/** Chỉ cho quay lại đường dẫn nội bộ, đúng khu vực của vai trò (chống open redirect). */
function redirectTarget(next: string | null, role: Role): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return ROLE_HOME[role];
  if (role === 'CUSTOMER' && next.startsWith('/quan-tri')) return ROLE_HOME[role];
  return next;
}

export function LoginPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<LoginErrors>({});
  const [capsLock, setCapsLock] = useState(false);
  /** Email đang bị khoá: khoá theo email nên đổi email khác vẫn đăng nhập được (ADR-0008). */
  const [lockedEmail, setLockedEmail] = useState<string>();
  const limit = useSyncExternalStore(rateLimitStore.subscribe, rateLimitStore.getSnapshot);

  if (session && !login.isPending) {
    return <Navigate to={redirectTarget(params.get('next'), session.user.role)} replace />;
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const errors = validateLogin(email, password);
    setFieldErrors(errors);
    if (errors.email || errors.password) return;

    login.mutate(
      { email: email.trim(), password },
      {
        onSuccess: (result) =>
          navigate(redirectTarget(params.get('next'), result.user.role), { replace: true }),
        onError: (error) => {
          if (isApiError(error) && error.code === 'LOGIN_LOCKED') setLockedEmail(email.trim());
        },
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

  const locked = limit?.code === 'LOGIN_LOCKED';
  const blocked = limit !== null && (!locked || email.trim() === lockedEmail);
  const trackCapsLock = (event: KeyboardEvent<HTMLInputElement>) =>
    setCapsLock(event.getModifierState('CapsLock'));

  return (
    <div className="space-y-space-lg">
      <Breadcrumb items={[{ label: 'Đăng nhập tài khoản' }]} />
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
          {locked && HOTLINE && (
            <a
              href={HOTLINE.href}
              className="mt-space-sm inline-flex items-center gap-space-xs rounded-lg bg-surface-container-low px-space-md py-space-xs text-label-md text-on-surface"
            >
              <Icon name="support_agent" className="text-base" />
              Liên hệ Hotline {HOTLINE.value}
            </a>
          )}

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
              onChange={(event) => {
                setEmail(event.target.value);
                setFieldErrors((prev) => ({ ...prev, email: undefined }));
              }}
              error={fieldErrors.email}
              hint={isEmailFormat(email) ? 'Định dạng hợp lệ' : undefined}
              required
            />
            <Input
              label="Mật khẩu"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              icon="lock"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setFieldErrors((prev) => ({ ...prev, password: undefined }));
              }}
              onKeyUp={trackCapsLock}
              error={fieldErrors.password}
              hint={capsLock ? 'Đang bật Caps Lock' : undefined}
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
              disabled={blocked}
              iconRight="arrow_forward"
            >
              Đăng nhập ShopFast
            </Button>
          </form>

          <p className="mt-space-lg text-center">
            <Link
              to="/xac-minh-otp"
              state={isEmailFormat(email) ? { email: email.trim() } : undefined}
              className="text-title-sm text-primary hover:underline"
            >
              Xác minh email bằng mã OTP
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
