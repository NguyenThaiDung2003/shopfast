import { useState, type FormEvent } from 'react';
import { cn } from '../../lib/cn';
import { Icon } from './Icon';

export interface SearchInputProps {
  /** Từ khoá đang áp dụng (từ URL). Đổi giá trị này → ô nhập đặt lại (dùng kèm `key`). */
  initial: string;
  /** Enter: gọi với từ khoá đã chuẩn hoá; `undefined` = bỏ lọc. */
  onSearch: (q?: string) => void;
  /** Validate trước khi tìm; trả `error` thì hiện lỗi và không gọi `onSearch`. */
  validate: (text: string) => { q?: string; error?: string };
  /** Nhãn cho trình đọc màn hình. */
  label: string;
  placeholder?: string;
  className?: string;
}

/** Ô tìm kiếm của bảng/danh sách nhân viên: Enter để tìm, nút × để xoá, lỗi hiện dưới ô. */
export function SearchInput({
  initial,
  onSearch,
  validate,
  label,
  placeholder,
  className,
}: SearchInputProps) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string>();
  const errorId = `${label.replace(/\s+/g, '-')}-error`;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validate(text);
    setError(result.error);
    if (!result.error) onSearch(result.q);
  };

  return (
    <form role="search" onSubmit={submit} noValidate className={className}>
      <div
        className={cn(
          'flex items-center rounded-lg bg-surface-container-low pl-space-md pr-space-xs focus-within:bg-surface-container-lowest focus-within:ring-2',
          error ? 'ring-2 ring-error' : 'focus-within:ring-primary',
        )}
      >
        <Icon name="search" className="mr-space-sm text-lg text-outline" />
        <input
          type="search"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(undefined);
          }}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          placeholder={placeholder}
          className="h-10 w-full min-w-0 bg-transparent text-body-sm text-on-surface placeholder:text-outline focus:outline-none"
        />
        {initial && (
          <button
            type="button"
            onClick={() => {
              setText('');
              setError(undefined);
              onSearch(undefined);
            }}
            aria-label="Xoá từ khoá"
            className="rounded-full p-space-xs text-outline hover:text-on-surface"
          >
            <Icon name="close" className="text-lg" />
          </button>
        )}
      </div>
      {error && (
        <p id={errorId} className="mt-space-xs text-body-sm text-error">
          {error}
        </p>
      )}
    </form>
  );
}
