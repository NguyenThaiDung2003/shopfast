import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api/errors';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Modal,
  Select,
  Table,
  useToast,
  type TableColumn,
} from '../components/ui';
import { formatDateTime, formatNumber } from '../lib/format';
import { ServiceCard } from '../system/ServiceCard';
import {
  BULL_BOARD_URL,
  fetchCacheStats,
  fetchHealth,
  fetchQueueStats,
  fetchVersion,
  openQueueSession,
  resetCacheStats,
  systemKeys,
  type QueueStats,
} from '../system/system-api';
import {
  CACHE_TARGET,
  cacheRateTone,
  DEFAULT_REFRESH,
  dependencyView,
  formatPercent,
  formatUptime,
  cacheNamespaceLabel,
  isDeadLetter,
  OVERALL_STATUS,
  parseRefresh,
  queueDescription,
  queueProblemCount,
  REFRESH_OPTIONS,
  refreshInterval,
} from '../system/system-view';

function SectionError({ title, query }: { title: string; query: UseQueryResult<unknown> }) {
  return (
    <EmptyState
      icon="cloud_off"
      title={title}
      description={errorMessage(query.error)}
      action={
        <Button
          variant="brand"
          icon="refresh"
          loading={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Thử lại
        </Button>
      }
    />
  );
}

function Skeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="animate-pulse space-y-space-sm p-space-lg">
      <div className="h-5 w-1/3 rounded bg-surface-container-high" />
      <div className="h-16 rounded-lg bg-surface-container-low" />
    </div>
  );
}

const QUEUE_COLUMNS: TableColumn<QueueStats>[] = [
  {
    key: 'name',
    header: 'Tên hàng đợi',
    className: 'min-w-[240px]',
    render: (queue) => (
      <div>
        <p className="flex items-center gap-space-xs font-mono text-title-sm text-primary">
          {queue.name}
          {isDeadLetter(queue) && <Badge tone="danger">Hàng đợi lỗi</Badge>}
        </p>
        <p className="text-body-sm text-on-surface-variant">{queueDescription(queue.name)}</p>
      </div>
    ),
  },
  { key: 'waiting', header: 'Đang chờ', render: (q) => formatNumber(q.waiting) },
  { key: 'active', header: 'Đang chạy', render: (q) => formatNumber(q.active) },
  { key: 'delayed', header: 'Hẹn giờ', render: (q) => formatNumber(q.delayed) },
  { key: 'completed', header: 'Hoàn tất (còn lưu)', render: (q) => formatNumber(q.completed) },
  {
    key: 'failed',
    header: 'Thất bại',
    render: (queue) => {
      const problems = queueProblemCount(queue);
      return (
        <Badge
          tone={problems > 0 ? 'danger' : 'success'}
          icon={problems > 0 ? 'warning' : 'check'}
          pill
        >
          {formatNumber(problems)} lỗi
        </Badge>
      );
    },
  },
];

/** Trang "Giám sát hệ thống" (thiết kế apps/web/design/giam-sat-he-thong). */
export function SystemMonitorPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const refresh = parseRefresh(params.get('refresh'));
  const refetchInterval = refreshInterval(refresh);
  const [confirmReset, setConfirmReset] = useState(false);
  const [opening, setOpening] = useState(false);

  const health = useQuery({
    queryKey: systemKeys.health,
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval,
  });
  const cache = useQuery({
    queryKey: systemKeys.cache,
    queryFn: ({ signal }) => fetchCacheStats(signal),
    refetchInterval,
  });
  const queues = useQuery({
    queryKey: systemKeys.queues,
    queryFn: ({ signal }) => fetchQueueStats(signal),
    refetchInterval,
  });
  const version = useQuery({
    queryKey: systemKeys.version,
    queryFn: ({ signal }) => fetchVersion(signal),
  });

  const reset = useMutation({
    mutationFn: resetCacheStats,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: systemKeys.cache });
      setConfirmReset(false);
      toast.success('Đã đặt lại bộ đếm cache');
    },
    onError: (error) => {
      setConfirmReset(false);
      toast.error('Không đặt lại được bộ đếm', errorMessage(error));
    },
  });

  const copyCommit = (commit: string) => {
    void navigator.clipboard?.writeText(commit).then(
      () => toast.success('Đã sao chép commit', commit),
      () => undefined,
    );
  };

  /** Mở tab ngay trong lúc bấm để không bị chặn popup, có cookie phiên rồi mới chuyển trang. */
  const openBoard = async () => {
    const tab = window.open('', '_blank');
    setOpening(true);
    try {
      await openQueueSession();
      if (tab) tab.location.href = BULL_BOARD_URL;
      else
        toast.error('Trình duyệt đã chặn cửa sổ mới', 'Hãy cho phép cửa sổ bật lên rồi thử lại.');
    } catch (error) {
      tab?.close();
      toast.error('Không mở được bảng điều khiển', errorMessage(error));
    } finally {
      setOpening(false);
    }
  };

  const report = health.data;
  const overall = report ? OVERALL_STATUS[report.status] : undefined;
  const checkedAt = report?.timestamp ? formatDateTime(report.timestamp) : 'Không có';
  const total = cache.data?.total;
  const reads = total ? total.hits + total.misses : 0;

  const renderServices = () => {
    if (health.isPending) return <Skeleton label="Đang kiểm tra dịch vụ" />;
    if (!report) {
      return (
        <Card flush>
          <SectionError title="Không kiểm tra được dịch vụ" query={health} />
        </Card>
      );
    }
    return (
      <div className="grid grid-cols-1 gap-space-md md:grid-cols-2 xl:grid-cols-3">
        <ServiceCard
          name="Cơ sở dữ liệu"
          subtitle="PostgreSQL"
          icon="database"
          status={dependencyView(report.checks.database, true)}
          metrics={[
            { label: 'Độ trễ kiểm tra', value: `${report.checks.database.latencyMs}ms` },
            { label: 'Kiểm tra lúc', value: checkedAt },
          ]}
        />
        <ServiceCard
          name="Redis"
          subtitle="Cache, giới hạn tần suất, hàng đợi"
          icon="memory"
          status={dependencyView(report.checks.redis, false)}
          metrics={[
            { label: 'Độ trễ kiểm tra', value: `${report.checks.redis.latencyMs}ms` },
            { label: 'Kiểm tra lúc', value: checkedAt },
          ]}
        />
        <ServiceCard
          name="Máy chủ API"
          subtitle={
            version.data
              ? `${version.data.environment} • Node.js ${version.data.nodeVersion}`
              : 'NestJS'
          }
          icon="dns"
          metrics={[
            {
              label: 'Thời gian chạy',
              value: report.uptimeSeconds === undefined ? '—' : formatUptime(report.uptimeSeconds),
            },
            { label: 'Phiên bản', value: version.data?.version ?? '—' },
          ]}
        />
      </div>
    );
  };

  const renderCache = () => {
    if (cache.isPending) return <Skeleton label="Đang tải thống kê cache" />;
    if (cache.isError || !cache.data || !total) {
      return <SectionError title="Không tải được thống kê cache" query={cache} />;
    }
    if (!cache.data.enabled) {
      return (
        <EmptyState
          icon="cloud_off"
          title="Cache đang tắt"
          description="CACHE_ENABLED=false: mọi lượt đọc đi thẳng vào cơ sở dữ liệu."
        />
      );
    }
    if (reads === 0) {
      return (
        <EmptyState
          icon="query_stats"
          title="Chưa có lượt đọc nào"
          description="Số liệu sẽ xuất hiện khi khách xem sản phẩm."
        />
      );
    }
    return (
      <div className="grid gap-space-lg p-space-lg lg:grid-cols-2">
        <div className="space-y-space-sm">
          <div className="flex flex-wrap items-center justify-between gap-space-sm">
            <p className="text-label-md uppercase tracking-wider text-on-surface-variant">
              Tỷ lệ trúng cache
            </p>
            <Badge tone={cacheRateTone(total.hitRate, reads)}>
              Mục tiêu: &gt; {formatPercent(CACHE_TARGET)}
            </Badge>
          </div>
          <p className="text-display-hero text-on-surface" data-testid="cache-rate">
            {formatPercent(total.hitRate)}
          </p>
          <p className="text-body-md text-on-surface-variant">
            {formatNumber(total.hits)} lượt trúng • {formatNumber(total.misses)} lượt trượt
          </p>
        </div>
        <ul aria-label="Theo nhóm cache" className="space-y-space-sm">
          {cache.data.namespaces.map((ns) => (
            <li key={ns.name}>
              <div className="flex justify-between gap-space-sm text-body-md">
                <span className="text-on-surface">{cacheNamespaceLabel(ns.name)}</span>
                <span className="text-on-surface-variant">{formatPercent(ns.hitRate)}</span>
              </div>
              <div
                aria-hidden
                className="mt-space-xs h-2 overflow-hidden rounded-full bg-surface-container-high"
              >
                <div
                  className="h-full rounded-full bg-primary-container"
                  style={{ width: `${Math.round(ns.hitRate * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const renderQueues = () => {
    if (queues.isPending) return <Skeleton label="Đang tải hàng đợi" />;
    if (queues.isError) return <SectionError title="Không tải được hàng đợi" query={queues} />;
    return (
      <Table
        caption="Thống kê hàng đợi"
        columns={QUEUE_COLUMNS}
        rows={queues.data}
        rowKey={(queue) => queue.name}
        rowClassName={(queue) => (isDeadLetter(queue) ? 'bg-error-container/20' : undefined)}
        empty={<EmptyState icon="inbox" title="Chưa có hàng đợi nào" />}
      />
    );
  };

  return (
    <div className="space-y-space-lg">
      <div className="flex flex-col justify-between gap-space-md xl:flex-row xl:items-start">
        <div className="space-y-space-xs">
          <div className="flex flex-wrap items-center gap-space-sm">
            <Badge tone="primary">Vận hành</Badge>
            {overall && (
              <Badge tone={overall.tone} pill>
                {overall.label}
              </Badge>
            )}
          </div>
          <h1 className="text-headline-lg-mobile text-on-surface md:text-headline-lg">
            Giám sát hệ thống &amp; Hạ tầng kỹ thuật
          </h1>
          <p className="max-w-3xl text-body-md text-on-surface-variant">
            Theo dõi tình trạng dịch vụ lõi, hiệu quả cache và các hàng đợi tác vụ nền.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-space-sm">
          {version.data && (
            <span className="flex h-10 items-center gap-space-sm rounded-lg bg-surface-container-lowest px-space-md text-label-md text-on-surface shadow-card">
              <Icon name="deployed_code" className="text-lg" />
              {version.data.version}
              <span className="font-mono text-primary">git#{version.data.commit}</span>
              <button
                type="button"
                aria-label="Sao chép commit"
                onClick={() => copyCommit(version.data.commit)}
                className="rounded p-0.5 text-outline hover:text-primary"
              >
                <Icon name="content_copy" className="text-base" />
              </button>
            </span>
          )}
          <Select
            label="Tự động làm mới"
            value={refresh}
            options={REFRESH_OPTIONS.map((option) => ({ ...option }))}
            containerClassName="w-36"
            onChange={(event) => {
              const next = new URLSearchParams(params);
              if (event.target.value === DEFAULT_REFRESH) next.delete('refresh');
              else next.set('refresh', event.target.value);
              setParams(next, { replace: true });
            }}
          />
          <Button
            variant="brand"
            icon="refresh"
            onClick={() => void queryClient.invalidateQueries({ queryKey: systemKeys.all })}
          >
            Làm mới
          </Button>
        </div>
      </div>

      <section aria-label="Trạng thái dịch vụ lõi" className="space-y-space-md">
        <h2 className="flex items-center gap-space-sm text-headline-sm text-on-surface">
          <Icon name="dns" className="text-primary" />
          Trạng thái dịch vụ lõi
        </h2>
        {renderServices()}
      </section>

      <section aria-label="Hiệu quả cache" className="space-y-space-md">
        <div className="flex flex-wrap items-center justify-between gap-space-sm">
          <h2 className="flex items-center gap-space-sm text-headline-sm text-on-surface">
            <Icon name="analytics" className="text-primary" />
            Hiệu quả cache
          </h2>
          <Button
            size="sm"
            variant="outline"
            icon="restart_alt"
            disabled={!cache.data}
            onClick={() => setConfirmReset(true)}
          >
            Đặt lại bộ đếm
          </Button>
        </div>
        <Card flush>{renderCache()}</Card>
      </section>

      <section aria-label="Hàng đợi tác vụ nền">
        <Card flush className="overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-space-md p-space-lg">
            <div>
              <h2 className="flex items-center gap-space-sm text-headline-sm text-on-surface">
                <Icon name="dynamic_form" className="text-primary" />
                Hàng đợi xử lý tác vụ nền (BullMQ)
              </h2>
              <p className="text-body-md text-on-surface-variant">
                Thử lại tác vụ và xem nhật ký tại bảng điều khiển hàng đợi.
              </p>
            </div>
            <div className="flex flex-wrap gap-space-sm">
              <Button
                variant="outline"
                icon="sync"
                loading={queues.isFetching && !queues.isPending}
                onClick={() => void queues.refetch()}
              >
                Làm mới hàng đợi
              </Button>
              <Button
                variant="brand"
                iconRight="open_in_new"
                loading={opening}
                onClick={() => void openBoard()}
              >
                Mở bảng điều khiển hàng đợi
              </Button>
            </div>
          </div>
          {renderQueues()}
        </Card>
      </section>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        dismissible={!reset.isPending}
        size="sm"
        icon="restart_alt"
        title="Đặt lại bộ đếm cache?"
        footer={
          <>
            <Button
              variant="outline"
              disabled={reset.isPending}
              onClick={() => setConfirmReset(false)}
            >
              Huỷ bỏ
            </Button>
            <Button variant="danger" loading={reset.isPending} onClick={() => reset.mutate()}>
              Đặt lại
            </Button>
          </>
        }
      >
        Số lượt trúng và trượt cache về 0 để đo lại từ đầu. Dữ liệu trong cache không bị xoá.
      </Modal>
    </div>
  );
}
