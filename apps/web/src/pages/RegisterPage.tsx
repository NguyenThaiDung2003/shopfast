import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { errorMessage, isApiError } from '../api/errors';
import { register } from '../auth/auth-api';
import {
  hasErrors,
  validateRegister,
  type RegisterErrors,
  type RegisterValues,
} from '../auth/register-form';
import { ROLE_HOME } from '../auth/roles';
import { useSession } from '../auth/useAuth';
import { RateLimitBanner } from '../components/RateLimitBanner';
import { Button, Card, Icon, Input } from '../components/ui';

const EMPTY: RegisterValues = { fullName: '', email: '', password: '', confirmPassword: '' };

/** Trang đăng ký khách hàng; đăng ký xong chuyển sang nhập OTP. */
export function RegisterPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [values, setValues] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<RegisterErrors>({});

  const submit = useMutation({
    mutationFn: () =>
      register({
        fullName: values.fullName.trim(),
        email: values.email.trim(),
        password: values.password,
      }),
    onSuccess: (result) => navigate('/xac-minh-otp', { state: result, replace: true }),
  });

  if (session) return <Navigate to={ROLE_HOME[session.user.role]} replace />;

  const field = (name: keyof RegisterValues) => ({
    value: values[name],
    error: fieldErrors[name],
    required: true,
    onChange: (event: { target: { value: string } }) => {
      setValues((prev) => ({ ...prev, [name]: event.target.value }));
      setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const errors = validateRegister(values);
    setFieldErrors(errors);
    if (!hasErrors(errors)) submit.mutate();
  };

  const emailTaken = isApiError(submit.error) && submit.error.code === 'EMAIL_ALREADY_EXISTS';
  // 429 hiện ở banner đếm ngược.
  const formError =
    submit.error && !(isApiError(submit.error) && submit.error.status === 429)
      ? errorMessage(submit.error)
      : null;

  return (
    <div className="mx-auto max-w-xl space-y-space-md">
      <RateLimitBanner />
      <Card className="p-space-xl md:p-10">
        <h1 className="text-headline-lg-mobile text-on-surface md:text-headline-lg">
          Tạo tài khoản ShopFast
        </h1>
        <p className="mt-space-xs text-body-md text-on-surface-variant">
          Chúng tôi sẽ gửi mã xác minh tới email của bạn.
        </p>

        {formError && (
          <div
            role="alert"
            className="mt-space-lg rounded-lg bg-error-container p-space-md text-body-md text-on-error-container"
          >
            <p className="flex items-start gap-space-sm">
              <Icon name="error" className="text-lg" />
              {formError}
            </p>
            {emailTaken && (
              <p className="mt-space-xs flex gap-space-md text-title-sm">
                <Link to="/dang-nhap" state={{ email: values.email.trim() }} className="underline">
                  Đăng nhập
                </Link>
                <Link
                  to="/quen-mat-khau"
                  state={{ email: values.email.trim() }}
                  className="underline"
                >
                  Quên mật khẩu
                </Link>
              </p>
            )}
          </div>
        )}

        <form onSubmit={onSubmit} noValidate className="mt-space-xl space-y-space-lg">
          <Input label="Họ và tên" autoComplete="name" icon="person" {...field('fullName')} />
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            icon="alternate_email"
            {...field('email')}
          />
          <Input
            label="Mật khẩu"
            type="password"
            autoComplete="new-password"
            icon="lock"
            hint="Từ 8 ký tự, có cả chữ và số"
            {...field('password')}
          />
          <Input
            label="Nhập lại mật khẩu"
            type="password"
            autoComplete="new-password"
            icon="lock"
            {...field('confirmPassword')}
          />
          <Button
            type="submit"
            size="lg"
            fullWidth
            loading={submit.isPending}
            iconRight="arrow_forward"
          >
            Tạo tài khoản
          </Button>
        </form>

        <p className="mt-space-lg text-center text-body-md text-on-surface-variant">
          Đã có tài khoản?{' '}
          <Link to="/dang-nhap" className="text-title-sm text-primary hover:underline">
            Đăng nhập
          </Link>
        </p>
      </Card>
    </div>
  );
}
