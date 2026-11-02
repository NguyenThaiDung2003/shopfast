import { useEffect, useRef } from 'react';
import { Button, Icon, OtpInput } from '../components/ui';
import { formatCountdown } from '../lib/format';
import type { OtpRequest } from './useOtpRequest';

interface OtpCodeFieldsProps {
  otp: OtpRequest;
  code: string;
  onChange: (code: string) => void;
  error?: string;
  /** Sai quá số lần, mã đã bị huỷ. */
  exhausted: boolean;
  busy: boolean;
}

/** Ô nhập mã, đếm ngược hạn mã và nút gửi lại. */
export function OtpCodeFields({ otp, code, onChange, error, exhausted, busy }: OtpCodeFieldsProps) {
  const firstBox = useRef<HTMLInputElement>(null);

  // Ô bị khoá trong lúc gửi nên chỉ focus được sau khi request kết thúc.
  useEffect(() => {
    if (error && !busy) firstBox.current?.focus();
  }, [error, busy]);

  return (
    <>
      <OtpInput
        ref={firstBox}
        value={code}
        disabled={exhausted || otp.expired || busy}
        invalid={Boolean(error)}
        describedBy={error ? 'otp-error' : undefined}
        onChange={onChange}
      />
      {error && (
        <p id="otp-error" role="alert" className="text-center text-body-md text-error">
          {error}
        </p>
      )}
      <p className="flex items-center justify-center gap-space-xs text-body-md text-primary">
        <Icon name="schedule" className="text-lg" />
        {otp.expired ? (
          <span className="text-error">Mã đã hết hạn, vui lòng gửi lại mã mới.</span>
        ) : exhausted ? (
          <span className="text-error">Mã đã bị huỷ, vui lòng gửi lại mã mới.</span>
        ) : (
          <>
            Mã OTP có hiệu lực trong:{' '}
            <strong className="tabular-nums text-secondary">
              {formatCountdown(otp.expiresIn)}
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
          loading={otp.sending}
          disabled={otp.resendIn > 0 || otp.sendBlocked}
          onClick={() => otp.send(otp.sentTo!)}
        >
          {otp.resendIn > 0 ? `Gửi lại mã ${otp.resendIn}s` : 'Gửi lại mã'}
        </Button>
      </div>
    </>
  );
}
