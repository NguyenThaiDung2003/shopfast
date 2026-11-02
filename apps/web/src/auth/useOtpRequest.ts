import { useMutation } from '@tanstack/react-query';
import { useState, useSyncExternalStore } from 'react';
import { errorMessage, isApiError } from '../api/errors';
import { rateLimitStore } from '../api/rate-limit';
import { useCountdown } from '../lib/useCountdown';
import { sendOtp, type OtpPurpose } from './otp-api';
import { RESEND_SECONDS } from './otp-form';

export interface OtpAlreadySent {
  email: string;
  expiresInSeconds: number;
}

/** Gửi mã và đếm ngược hạn mã, thời gian chờ gửi lại; dùng chung cho xác minh và quên mật khẩu. */
export function useOtpRequest(
  purpose: OtpPurpose,
  { initial, onSent }: { initial?: OtpAlreadySent; onSent?: () => void } = {},
) {
  const [sentTo, setSentTo] = useState(initial?.email);
  const [expiresAt, setExpiresAt] = useState(() =>
    initial ? Date.now() + initial.expiresInSeconds * 1000 : null,
  );
  // Hạn 0: đăng ký xong nhưng chưa gửi được mã, cho gửi lại ngay.
  const [resendAt, setResendAt] = useState(() =>
    initial?.expiresInSeconds ? Date.now() + RESEND_SECONDS * 1000 : null,
  );
  const [sendError, setSendError] = useState<string>();

  const limit = useSyncExternalStore(rateLimitStore.subscribe, rateLimitStore.getSnapshot);
  const expiresIn = useCountdown(expiresAt);
  const resendIn = useCountdown(resendAt);

  const mutation = useMutation({
    mutationFn: (email: string) => sendOtp(email, purpose),
    onSuccess: ({ expiresInSeconds }, email) => {
      if (limit?.code === 'OTP_TOO_MANY_ATTEMPTS') rateLimitStore.clear();
      setSentTo(email);
      setExpiresAt(Date.now() + expiresInSeconds * 1000);
      setResendAt(Date.now() + RESEND_SECONDS * 1000);
      setSendError(undefined);
      onSent?.();
    },
    onError: (error) => {
      // 429 đã hiện ở RateLimitBanner.
      if (!(isApiError(error) && error.status === 429)) setSendError(errorMessage(error));
    },
  });

  return {
    sentTo,
    sendError,
    expiresIn,
    resendIn,
    expired: expiresAt !== null && expiresIn === 0,
    // Sai quá số lần không cấm gửi mã mới; các 429 khác thì phải chờ.
    sendBlocked: limit !== null && limit.code !== 'OTP_TOO_MANY_ATTEMPTS',
    sending: mutation.isPending,
    send: mutation.mutate,
  };
}

export type OtpRequest = ReturnType<typeof useOtpRequest>;
