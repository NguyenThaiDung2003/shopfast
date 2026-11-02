import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { errorMessage, isApiError } from '../api/errors';
import { isEmailFormat } from '../auth/login-form';
import { resetPassword } from '../auth/otp-api';
import { maskEmail, validateOtpCode } from '../auth/otp-form';
import { OtpCodeFields } from '../auth/OtpCodeFields';
import { OtpHeading } from '../auth/OtpHeading';
import { validateConfirmPassword, validateNewPassword } from '../auth/register-form';
import { useOtpRequest } from '../auth/useOtpRequest';
import { RateLimitBanner } from '../components/RateLimitBanner';
import { Button, Card, Icon, Input } from '../components/ui';

/** Quên mật khẩu: nhập email, nhận mã, rồi nhập mã cùng mật khẩu mới trên một màn hình. */
export function ForgotPasswordPage() {
  const location = useLocation();
  const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? '');
  const [emailError, setEmailError] = useState<string>();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string>();
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string>();
  const [confirm, setConfirm] = useState('');
  const [confirmError, setConfirmError] = useState<string>();
  const [exhausted, setExhausted] = useState(false);
  const [done, setDone] = useState(false);

  const otp = useOtpRequest('RESET_PASSWORD', {
    onSent: () => {
      setCode('');
      setCodeError(undefined);
      setExhausted(false);
    },
  });
  const { sentTo } = otp;

  const reset = useMutation({
    mutationFn: () => resetPassword({ email: sentTo!, code, newPassword: password }),
    onSuccess: () => setDone(true),
    onError: (error) => {
      setCode('');
      if (isApiError(error) && error.code === 'OTP_TOO_MANY_ATTEMPTS') {
        setExhausted(true);
        setCodeError(undefined);
        return;
      }
      setCodeError(errorMessage(error));
    },
  });

  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    const target = email.trim();
    if (!isEmailFormat(target)) {
      setEmailError(target ? 'Email không đúng định dạng.' : 'Vui lòng nhập email.');
      return;
    }
    setEmailError(undefined);
    otp.send(target);
  };

  const submitReset = (event: FormEvent) => {
    event.preventDefault();
    const invalidCode = validateOtpCode(code);
    const invalidPassword = validateNewPassword(password);
    const invalidConfirm = validateConfirmPassword(password, confirm);
    setCodeError(invalidCode);
    setPasswordError(invalidPassword);
    setConfirmError(invalidConfirm);
    if (!invalidCode && !invalidPassword && !invalidConfirm) reset.mutate();
  };

  if (done) {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="space-y-space-lg p-space-xl text-center">
          <OtpHeading title="Đã đặt lại mật khẩu">
            Mọi phiên đăng nhập cũ đã được đăng xuất. Hãy đăng nhập bằng mật khẩu mới.
          </OtpHeading>
          <Link
            to="/dang-nhap"
            state={{ email: sentTo }}
            className="flex h-12 items-center justify-center rounded-lg bg-secondary-container text-title-md text-on-secondary hover:bg-secondary"
          >
            Về trang Đăng nhập
          </Link>
        </Card>
      </div>
    );
  }

  const sendAlert = otp.sendError && (
    <p
      role="alert"
      className="flex items-start gap-space-sm rounded-lg bg-error-container/60 px-space-md py-space-sm text-body-md text-on-error-container"
    >
      <Icon name="error" className="text-lg" />
      {otp.sendError}
    </p>
  );

  return (
    <div className="mx-auto max-w-xl space-y-space-md">
      <RateLimitBanner />
      <Card className="space-y-space-lg p-space-lg md:p-space-xl">
        {!sentTo ? (
          <>
            <OtpHeading title="Quên mật khẩu">
              Nhập email tài khoản để nhận mã đặt lại mật khẩu.
            </OtpHeading>
            {sendAlert}
            <form onSubmit={submitEmail} noValidate className="space-y-space-lg">
              <Input
                label="Email"
                type="email"
                autoComplete="email"
                icon="alternate_email"
                required
                value={email}
                error={emailError}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailError(undefined);
                }}
              />
              <Button
                type="submit"
                size="lg"
                fullWidth
                iconRight="arrow_forward"
                loading={otp.sending}
                disabled={otp.sendBlocked}
              >
                Gửi mã đặt lại
              </Button>
            </form>
          </>
        ) : (
          <>
            <OtpHeading title="Đặt mật khẩu mới">
              Nếu <strong className="text-on-surface">{maskEmail(sentTo)}</strong> có tài khoản, mã
              6 chữ số đã được gửi tới email này.
            </OtpHeading>
            {sendAlert}
            <form onSubmit={submitReset} noValidate className="space-y-space-lg">
              <OtpCodeFields
                otp={otp}
                code={code}
                error={codeError}
                exhausted={exhausted}
                busy={reset.isPending}
                onChange={(next) => {
                  setCode(next);
                  setCodeError(undefined);
                }}
              />
              <Input
                label="Mật khẩu mới"
                type="password"
                autoComplete="new-password"
                icon="lock"
                hint="Từ 8 ký tự, có cả chữ và số"
                required
                value={password}
                error={passwordError}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setPasswordError(undefined);
                }}
              />
              <Input
                label="Nhập lại mật khẩu mới"
                type="password"
                autoComplete="new-password"
                icon="lock"
                required
                value={confirm}
                error={confirmError}
                onChange={(event) => {
                  setConfirm(event.target.value);
                  setConfirmError(undefined);
                }}
              />
              <Button
                type="submit"
                size="lg"
                fullWidth
                iconRight="arrow_forward"
                loading={reset.isPending}
                disabled={exhausted || otp.expired}
              >
                Đặt lại mật khẩu
              </Button>
            </form>
          </>
        )}
        <div className="text-center">
          <Link
            to="/dang-nhap"
            className="inline-flex items-center gap-space-xs text-title-sm text-primary hover:underline"
          >
            <Icon name="arrow_back" className="text-lg" />
            Quay lại trang Đăng nhập
          </Link>
        </div>
      </Card>
    </div>
  );
}
