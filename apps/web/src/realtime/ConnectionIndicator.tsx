import { Icon, Spinner } from '../components/ui';
import { cn } from '../lib/cn';
import type { ConnectionState, SocketError } from './order-socket';

export interface ConnectionIndicatorProps {
  connection: ConnectionState;
  /** Lỗi subscribe của đơn (ví dụ ORDER_NOT_FOUND): kết nối được nhưng không nhận cập nhật. */
  subscribeError?: SocketError;
}

const VIEW: Record<ConnectionState, { label: string; className: string; dot?: string }> = {
  connected: {
    label: 'Đang cập nhật trực tiếp',
    className: 'bg-tertiary-fixed/60 text-on-tertiary-fixed-variant',
    dot: 'bg-tertiary-container animate-pulse',
  },
  connecting: {
    label: 'Đang kết nối…',
    className: 'bg-surface-container-high text-on-surface-variant',
  },
  reconnecting: {
    label: 'Mất kết nối, đang thử lại…',
    className: 'bg-secondary-fixed text-on-secondary-fixed-variant',
  },
  disconnected: {
    label: 'Đã ngắt cập nhật trực tiếp',
    className: 'bg-surface-container-high text-on-surface-variant',
    dot: 'bg-outline',
  },
};

/** Pill trạng thái kết nối realtime (thiết kế: "Đang cập nhật trực tiếp"). */
export function ConnectionIndicator({ connection, subscribeError }: ConnectionIndicatorProps) {
  if (subscribeError) {
    return (
      <span
        role="status"
        title={subscribeError.message}
        className="inline-flex items-center gap-space-sm rounded-full bg-surface-container-high px-space-md py-1.5 text-label-md text-on-surface-variant"
      >
        <Icon name="sync_disabled" className="text-base" />
        Không nhận được cập nhật trực tiếp
      </span>
    );
  }
  const view = VIEW[connection];
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        'inline-flex items-center gap-space-sm rounded-full px-space-md py-1.5 text-label-md',
        view.className,
      )}
    >
      {view.dot ? (
        <span className={cn('h-2.5 w-2.5 rounded-full', view.dot)} aria-hidden />
      ) : (
        <Spinner size="sm" label="" className="h-3 w-3" />
      )}
      {view.label}
    </span>
  );
}
