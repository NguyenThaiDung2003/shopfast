import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <EmptyState
        icon="travel_explore"
        title="Không tìm thấy trang"
        description="Đường dẫn không tồn tại hoặc đã được thay đổi."
        action={
          <Link
            to="/"
            className="inline-flex h-10 items-center rounded-lg bg-primary-container px-space-lg text-title-sm text-on-primary transition-colors hover:bg-primary"
          >
            Về trang chủ
          </Link>
        }
      />
    </div>
  );
}
