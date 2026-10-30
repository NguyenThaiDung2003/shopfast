import { useState } from 'react';
import { Icon } from '../components/ui';
import { cn } from '../lib/cn';
import { categoryIcon } from './product-display';

/** Ảnh sản phẩm; chưa có ảnh hoặc ảnh lỗi thì hiện icon theo danh mục. */
export function ProductImage({
  src,
  name,
  categorySlug,
  dimmed,
  iconClassName,
}: {
  src?: string | null;
  name: string;
  categorySlug: string;
  /** Làm mờ khi hết hàng. */
  dimmed?: boolean;
  iconClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <Icon
        name={categoryIcon(categorySlug)}
        className={cn(iconClassName, 'text-primary-fixed-dim', dimmed && 'opacity-50')}
      />
    );
  }
  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn(
        'h-full w-full object-cover transition-transform duration-300 group-hover:scale-105',
        dimmed && 'opacity-50',
      )}
    />
  );
}
