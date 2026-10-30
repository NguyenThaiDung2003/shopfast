import { Card, EmptyState } from '../components/ui';

export interface PlaceholderPageProps {
  title: string;
  icon?: string;
  description?: string;
}

/** Trang khung cho màn hình chưa dựng (khung app trước, màn nghiệp vụ làm sau). */
export function PlaceholderPage({
  title,
  icon = 'construction',
  description,
}: PlaceholderPageProps) {
  return (
    <div className="space-y-space-lg">
      <h1 className="text-headline-lg-mobile text-on-surface md:text-headline-lg">{title}</h1>
      <Card>
        <EmptyState
          icon={icon}
          title="Màn hình đang được xây dựng"
          description={description ?? 'Chức năng này sẽ có trong bản cập nhật tiếp theo.'}
        />
      </Card>
    </div>
  );
}
