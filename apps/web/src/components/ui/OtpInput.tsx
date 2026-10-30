import { forwardRef, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { distributeDigits, OTP_LENGTH } from '../../auth/otp-form';
import { cn } from '../../lib/cn';

export interface OtpInputProps {
  /** Các chữ số đã nhập, liền nhau. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}

/** 6 ô nhập mã OTP: tự nhảy ô, Backspace lùi, mũi tên di chuyển, dán cả mã. `ref` là ô đầu. */
export const OtpInput = forwardRef<HTMLInputElement, OtpInputProps>(function OtpInput(
  { value, onChange, disabled, invalid, describedBy },
  ref,
) {
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const focusBox = (index: number) =>
    boxes.current[Math.max(0, Math.min(index, OTP_LENGTH - 1))]?.focus();

  const type = (index: number, raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return;
    if (digits.length > 1) {
      const next = distributeDigits(value, index, digits);
      onChange(next);
      focusBox(next.length);
      return;
    }
    const at = Math.min(index, value.length);
    onChange((value.slice(0, at) + digits + value.slice(at + 1)).slice(0, OTP_LENGTH));
    focusBox(at + 1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      const at = index < value.length ? index : index - 1;
      if (at < 0) return;
      onChange(value.slice(0, at) + value.slice(at + 1));
      focusBox(at);
    } else if (event.key === 'ArrowLeft') {
      focusBox(index - 1);
    } else if (event.key === 'ArrowRight') {
      focusBox(index + 1);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>, index: number) => {
    event.preventDefault();
    const next = distributeDigits(value, index, event.clipboardData.getData('text'));
    onChange(next);
    focusBox(next.length);
  };

  return (
    <div
      role="group"
      aria-label="Mã OTP"
      className="flex justify-center gap-space-xs sm:gap-space-md"
    >
      {Array.from({ length: OTP_LENGTH }, (_, index) => (
        <input
          key={index}
          ref={(el) => {
            boxes.current[index] = el;
            if (index === 0) {
              if (typeof ref === 'function') ref(el);
              else if (ref) ref.current = el;
            }
          }}
          value={value[index] ?? ''}
          onChange={(event) => type(index, event.target.value)}
          onKeyDown={(event) => onKeyDown(event, index)}
          onPaste={(event) => onPaste(event, index)}
          onFocus={(event) => event.target.select()}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          aria-label={`Chữ số ${index + 1}`}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'h-12 w-10 rounded-lg border bg-surface-container-lowest text-center text-headline-md text-on-surface shadow-card sm:h-16 sm:w-14',
            'focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-surface-container-low disabled:text-outline',
            invalid ? 'border-error' : 'border-outline-variant',
          )}
        />
      ))}
    </div>
  );
});
