import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, Icon } from '../components/ui';
import { formatDateTime } from '../lib/format';
import { fetchHealth, systemKeys } from '../system/system-api';
import { dependencyView } from '../system/system-view';

/**
 * Trang "Sự cố hệ thống" (thiết kế loi-403-va-su-co-he-thong): `errorElement` của router.
 * Không hiện thông điệp hay stack của lỗi. Tình trạng dịch vụ đọc từ GET /health; không đọc
 * được thì ẩn phần đó, trang vẫn hiện.
 */
export function SystemErrorPage() {
  const health = useQuery({
    queryKey: systemKeys.health,
    queryFn: ({ signal }) => fetchHealth(signal),
    retry: false,
  });
  const report = health.data;
  const services = report
    ? [
        { name: 'Cơ sở dữ liệu', view: dependencyView(report.checks.database, true) },
        { name: 'Redis', view: dependencyView(report.checks.redis, false) },
      ]
    : [];

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-3xl space-y-space-lg p-space-lg text-center md:p-space-xl">
        <span className="mx-auto flex h-24 w-24 items-center justify-center rounded-xl bg-secondary-fixed text-secondary">
          <Icon name="cloud_off" className="text-5xl" />
        </span>
        <div className="space-y-space-xs">
          <Badge tone="danger" pill>
            Mã trạng thái HTTP 500: Lỗi hệ thống
          </Badge>
          <h1 className="text-headline-lg-mobile text-on-surface md:text-display-hero">
            <span className="text-primary">500</span> Lỗi hệ thống
          </h1>
          <p className="text-headline-sm text-on-surface">Đã có sự cố bất ngờ xảy ra</p>
          <p className="text-body-lg text-on-surface-variant">
            Trang này tạm thời không hiển thị được. Vui lòng tải lại trang hoặc thử lại sau ít phút.
          </p>
        </div>

        {report && (
          <section
            aria-label="Tình trạng dịch vụ"
            className="space-y-space-sm rounded-lg bg-surface-container-low p-space-md text-left"
          >
            <div className="flex flex-wrap items-center justify-between gap-space-sm">
              <h2 className="flex items-center gap-space-xs text-title-md text-on-surface">
                <Icon name="dns" className="text-primary" />
                Tình trạng dịch vụ ShopFast
              </h2>
              {report.timestamp && (
                <span className="text-body-sm text-on-surface-variant">
                  Kiểm tra lúc: {formatDateTime(report.timestamp)}
                </span>
              )}
            </div>
            <ul className="grid gap-space-sm sm:grid-cols-2">
              {services.map(({ name, view }) => (
                <li
                  key={name}
                  className="flex items-center justify-between gap-space-sm rounded-lg bg-surface-container-lowest p-space-md"
                >
                  <span className="text-title-sm text-on-surface">{name}</span>
                  <Badge tone={view.tone} icon={view.icon} pill>
                    {view.label}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="grid gap-space-sm sm:grid-cols-2">
          <Button size="lg" icon="refresh" onClick={() => window.location.reload()}>
            Thử tải lại trang
          </Button>
          {/* Tải lại toàn trang: thoát hẳn trạng thái lỗi của router. */}
          <a
            href="/"
            className="flex h-12 items-center justify-center gap-space-sm rounded-lg bg-primary-fixed text-title-md text-primary hover:bg-primary-fixed-dim"
          >
            <Icon name="home" className="text-lg" />
            Về trang chủ ShopFast
          </a>
        </div>
      </Card>
    </div>
  );
}
