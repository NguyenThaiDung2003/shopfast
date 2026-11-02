import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { errorMessage, isApiError } from '../api/errors';
import { isEmailFormat } from '../auth/login-form';
import { verifyOtp } from '../auth/otp-api';
import { maskEmail, validateOtpCode } from '../auth/otp-form';
import { OtpCodeFields } from '../auth/OtpCodeFields';
import { OtpHeading } from '../auth/OtpHeading';
import { useOtpRequest } from '../auth/useOtpRequest';
import { RateLimitBanner } from '../components/RateLimitBanner';
import { Button, Card, Icon, Input } from '../components/ui';

/** Trang "Xác thực mã OTP" (thiết kế apps/web/design/xac-nhan-otp-sau-so). */
export function OtpVerifyPage() {
  const location = useLocation();
  // Email đi qua location.state, không qua URL: không lưu vào lịch sử trình duyệt và log.
  // Có `expiresInSeconds`: trang đăng ký đã gửi mã, vào thẳng bước nhập mã.
  const state = location.state as { email?: string; expiresInSeconds?: number } | null;
  const [email, setEmail] = useState(state?.email ?? '');
  const [emailError, setEmailError] = useState<string>();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string>();
  const [exhausted, setExhausted] = useState(false);
  const [done, setDone] = useState(false);

  const otp = useOtpRequest('VERIFY_EMAIL', {
    initial:
      state?.email && state.expiresInSeconds !== undefined
        ? { email: state.email, expiresInSeconds: state.expiresInSeconds }
        : undefined,
    onSent: () => {
      setCode('');
      setCodeError(undefined);
      setExhausted(false);
    },
  });
  const { sentTo } = otp;

  const verify = useMutation({
    mutationFn: () => verifyOtp(sentTo!, code),
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

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    const invalid = validateOtpCode(code);
    setCodeError(invalid);
    if (!invalid) verify.mutate();
  };

  if (done) {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="space-y-space-lg p-space-xl text-center">
          <OtpHeading title="Email đã được xác minh">
            Tài khoản <strong>{maskEmail(sentTo!)}</strong> đã sẵn sàng, bạn có thể đăng nhập.
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
            <OtpHeading title="Xác thực mã bảo mật OTP">
              Nhập email để nhận mã xác thực gồm 6 chữ số.
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
                Gửi mã xác thực
              </Button>
            </form>
          </>
        ) : (
          <>
            <OtpHeading title="Xác thực mã bảo mật OTP">
              Mã xác thực 6 chữ số vừa được gửi đến{' '}
              <strong className="text-on-surface">{maskEmail(sentTo)}</strong>
            </OtpHeading>
            {sendAlert}
            <form onSubmit={submitCode} noValidate className="space-y-space-lg">
              <OtpCodeFields
                otp={otp}
                code={code}
                error={codeError}
                exhausted={exhausted}
                busy={verify.isPending}
                onChange={(next) => {
                  setCode(next);
                  setCodeError(undefined);
                }}
              />
              <Button
                type="submit"
                size="lg"
                fullWidth
                iconRight="arrow_forward"
                loading={verify.isPending}
                disabled={exhausted || otp.expired}
              >
                Xác nhận &amp; Tiếp tục
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
      <p className="rounded-lg bg-surface-container-low p-space-md text-center text-body-sm text-on-surface-variant">
        Không chia sẻ mã này cho bất kỳ ai, kể cả nhân viên hỗ trợ.
      </p>
    </div>
  );
}
