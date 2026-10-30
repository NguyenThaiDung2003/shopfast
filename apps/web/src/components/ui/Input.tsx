import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Field } from './Field';
import { controlClass, describedBy } from './field-styles';
import { Icon } from './Icon';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Icon Material Symbols đầu ô. */
  icon?: string;
  /** Phần tử cuối ô (nút hiện mật khẩu, đơn vị…). */
  trailing?: ReactNode;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { id, label, hint, error, icon, trailing, required, className, containerClassName, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field
      id={inputId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      <div className="relative">
        {icon && (
          <Icon
            name={icon}
            className="pointer-events-none absolute left-space-md top-1/2 -translate-y-1/2 text-outline"
          />
        )}
        <input
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(inputId, error, hint)}
          className={cn(
            controlClass(Boolean(error)),
            icon ? 'pl-10' : 'pl-space-md',
            trailing ? 'pr-11' : 'pr-space-md',
            className,
          )}
          {...rest}
        />
        {trailing && (
          <div className="absolute inset-y-0 right-space-xs flex items-center">{trailing}</div>
        )}
      </div>
    </Field>
  );
});
