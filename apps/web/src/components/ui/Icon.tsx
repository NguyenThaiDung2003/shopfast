import { cn } from '../../lib/cn';

export interface IconProps {
  /** Tên icon Material Symbols, ví dụ `shopping_cart`. */
  name: string;
  filled?: boolean;
  className?: string;
  /** Có nhãn → icon mang nghĩa (đọc được); không có → trang trí, ẩn khỏi trình đọc màn hình. */
  label?: string;
}

export function Icon({ name, filled, className, label }: IconProps) {
  return (
    <span
      className={cn('icon', filled && 'icon-filled', className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      {name}
    </span>
  );
}
