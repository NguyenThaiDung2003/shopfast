import { Link } from 'react-router-dom';
import { Icon } from '../components/ui';

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-space-xs" aria-label="ShopFast – trang chủ">
      <Icon name="bolt" filled className="text-3xl text-secondary-container" />
      <span className="text-headline-sm font-extrabold tracking-tight text-primary">ShopFast</span>
    </Link>
  );
}
