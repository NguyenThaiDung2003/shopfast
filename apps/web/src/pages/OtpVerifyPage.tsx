import { useMutation } from '@tanstack/react-query';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Link, useLocation } from 'react-router-dom';
import { errorMessage, isApiError } from '../api/errors';
import { rateLimitStore } from '../api/rate-limit';
import { isEmailFormat } from '../auth/login-form';
import { sendOtp, verifyOtp } from '../auth/otp-api';
import { maskEmail, RESEND_SECONDS, validateOtpCode } from '../auth/otp-form';
import { RateLimitBanner } from '../components/RateLimitBanner';
import { Button, Card, Icon, Input, OtpInput } from '../components/ui';
import { formatCountdown } from '../lib/format';
import { useCountdown } from '../lib/useCountdown';

function Heading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-space-sm text-center">
      <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-xl bg-primary-fixed text-primary">
        <Icon name="verified_user" className="text-4xl" />
      </span>
      <h1 className="text-headline-lg-mobile text-on-surface md:text-headline-lg">{title}</h1>
      <div className="text-body-md text-on-surface-variant">{children}</div>
    </div>
  );
}

/** Trang "Xác thực mã OTP" (thiết kế apps/web/design/xac-nhan-otp-sau-so). */
export function OtpVerifyPage() {
  const location = useLocation();
  // Email đi qua location.state, không qua URL: không lưu vào lịch sử trình duyệt và log.
  const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? '');
  const [emailError, setEmailError] = useState<string>();
  const [sentTo, setSentTo] = useState<string>();
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string>();
  const [sendError, setSendError] = useState<string>();
  const [exhausted, setExhausted] = useState(false);
  const [done, setDone] = useState(false);
  const firstBox = useRef<HTMLInputElement>(null);

  const limit = useSyncExternalStore(rateLimitStore.subscribe, rateLimitStore.getSnapshot);
  const expiresIn = useCountdown(expiresAt);
  const resendIn = useCountdown(resendAt);
  const expired = expiresAt !== null && expiresIn === 0;
  // Sai quá số lần không cấm gửi mã mới; các 429 khác thì phải chờ.
  const sendBlocked = limit !== null && limit.code !== 'OTP_TOO_MANY_ATTEMPTS';

  const send = useMutation({
    mutationFn: sendOtp,
    onSuccess: ({ expiresInSeconds }, target) => {
      if (limit?.code === 'OTP_TOO_MANY_ATTEMPTS') rateLimitStore.clear();
      setSentTo(target);
      setExpiresAt(Date.now() + expiresInSeconds * 1000);
      setResendAt(Date.now() + RESEND_SECONDS * 1000);
      setCode('');
      setCodeError(undefined);
      setExhausted(false);
      setSendError(undefined);
    },
    onError: (error) => {
      // 429 đã hiện ở RateLimitBanner.
      if (!(isApiError(error) && error.status === 429)) setSendError(errorMessage(error));
    },
  });

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

  // Ô bị khoá trong lúc gửi nên chỉ focus được sau khi request kết thúc.
  const verifying = verify.isPending;
  useEffect(() => {
    if (codeError && !verifying) firstBox.current?.focus();
  }, [codeError, verifying]);

  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    const target = email.trim();
    if (!isEmailFormat(target)) {
      setEmailError(target ? 'Email không đúng định dạng.' : 'Vui lòng nhập email.');
      return;
    }
    setEmailError(undefined);
    send.mutate(target);
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
          <Heading title="Mã xác thực hợp lệ">
            Bạn đã xác minh quyền sở hữu email <strong>{maskEmail(sentTo!)}</strong>.
          </Heading>
          <Link
            to="/dang-nhap"
            className="flex h-12 items-center justify-center rounded-lg bg-secondary-container text-title-md text-on-secondary hover:bg-secondary"
          >
            Về trang Đăng nhập
          </Link>
        </Card>
      </div>
    );
  }

  const sendAlert = sendError && (
    <p
      role="alert"
      className="flex items-start gap-space-sm rounded-lg bg-error-container/60 px-space-md py-space-sm text-body-md text-on-error-container"
    >
      <Icon name="error" className="text-lg" />
      {sendError}
    </p>
  );

  return (
    <div className="mx-auto max-w-xl space-y-space-md">
      <RateLimitBanner />
      <Card className="space-y-space-lg p-space-lg md:p-space-xl">
        {!sentTo ? (
          <>
            <Heading title="Xác thực mã bảo mật OTP">
              Nhập email để nhận mã xác thực gồm 6 chữ số.
            </Heading>
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
                loading={send.isPending}
                disabled={sendBlocked}
              >
                Gửi mã xác thực
              </Button>
            </form>
          </>
        ) : (
          <>
            <Heading title="Xác thực mã bảo mật OTP">
              Mã xác thực 6 chữ số vừa được gửi đến{' '}
              <strong className="text-on-surface">{maskEmail(sentTo)}</strong>
            </Heading>
            {sendAlert}
            <form onSubmit={submitCode} noValidate className="space-y-space-lg">
              <OtpInput
                ref={firstBox}
                value={code}
                disabled={exhausted || expired || verify.isPending}
                invalid={Boolean(codeError)}
                describedBy={codeError ? 'otp-error' : undefined}
                onChange={(next) => {
                  setCode(next);
                  setCodeError(undefined);
                }}
              />
              {codeError && (
                <p id="otp-error" role="alert" className="text-center text-body-md text-error">
                  {codeError}
                </p>
              )}
              <p className="flex items-center justify-center gap-space-xs text-body-md text-primary">
                <Icon name="schedule" className="text-lg" />
                {expired ? (
                  <span className="text-error">Mã đã hết hạn, vui lòng gửi lại mã mới.</span>
                ) : exhausted ? (
                  <span className="text-error">Mã đã bị huỷ, vui lòng gửi lại mã mới.</span>
                ) : (
                  <>
                    Mã OTP có hiệu lực trong:{' '}
                    <strong className="tabular-nums text-secondary">
                      {formatCountdown(expiresIn)}
                    </strong>
                  </>
                )}
              </p>
              <div className="flex flex-wrap items-center justify-between gap-space-md rounded-lg bg-surface-container-low p-space-md">
                <div>
                  <p className="text-title-sm text-on-surface">Chưa nhận được mã?</p>
                  <p className="text-body-sm text-on-surface-variant">
                    Kiểm tra hộp thư rác hoặc gửi lại mã mới
                  </p>
                </div>
                <Button
                  variant="tonal"
                  size="sm"
                  loading={send.isPending}
                  disabled={resendIn > 0 || sendBlocked}
                  onClick={() => send.mutate(sentTo)}
                >
                  {resendIn > 0 ? `Gửi lại mã ${resendIn}s` : 'Gửi lại mã'}
                </Button>
              </div>
              <Button
                type="submit"
                size="lg"
                fullWidth
                iconRight="arrow_forward"
                loading={verify.isPending}
                disabled={exhausted || expired}
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
