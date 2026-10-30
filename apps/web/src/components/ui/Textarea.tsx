import { forwardRef, useId, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';
import { formatNumber } from '../../lib/format';
import { Field } from './Field';
import { controlClass, describedBy } from './field-styles';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /**
   * Hiện bộ đếm "n/max" dưới ô. Không đặt `maxLength` gốc để dán quá dài vẫn thấy lỗi
   * validate thay vì bị cắt im lặng.
   */
  counterMax?: number;
  containerClassName?: string;
}

/** Ô nhập nhiều dòng cùng style với Input (nội dung ticket, tin nhắn…). */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    id,
    label,
    hint,
    error,
    counterMax,
    required,
    className,
    containerClassName,
    rows = 4,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const textareaId = id ?? autoId;
  const length = typeof rest.value === 'string' ? rest.value.length : undefined;
  return (
    <Field
      id={textareaId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      <textarea
        ref={ref}
        id={textareaId}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(textareaId, error, hint)}
        className={cn(
          controlClass(Boolean(error), true),
          'resize-y px-space-md py-space-sm',
          className,
        )}
        {...rest}
      />
      {counterMax !== undefined && length !== undefined && (
        <p
          className={cn(
            'self-end text-body-sm',
            length > counterMax ? 'text-error' : 'text-on-surface-variant',
          )}
        >
          {formatNumber(length)}/{formatNumber(counterMax)}
        </p>
      )}
    </Field>
  );
});
