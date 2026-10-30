import type { Key, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { EmptyState } from './EmptyState';
import { Spinner } from './Spinner';

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T, index: number) => ReactNode;
  align?: 'left' | 'center' | 'right';
  /** Ví dụ `w-32`, `min-w-[200px]`. */
  className?: string;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => Key;
  loading?: boolean;
  /** Nội dung khi không có dòng nào. */
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  /** Dòng đang chọn/nổi bật. */
  isRowActive?: (row: T) => boolean;
  caption?: string;
  className?: string;
}

const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

/** Bảng dữ liệu cho màn nhân viên (đơn kho, tồn kho, ticket). */
export function Table<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  onRowClick,
  isRowActive,
  caption,
  className,
}: TableProps<T>) {
  const hasRows = rows !== undefined && rows.length > 0;
  return (
    <div className={cn('relative overflow-x-auto', className)}>
      <table className="w-full border-collapse text-body-md">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-surface-container-high bg-surface-container-low">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'whitespace-nowrap px-space-lg py-space-md text-label-sm uppercase tracking-wider text-on-surface-variant',
                  ALIGN[column.align ?? 'left'],
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hasRows &&
            rows.map((row, index) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b border-surface-container-high/70 transition-colors last:border-b-0',
                  onRowClick && 'cursor-pointer',
                  isRowActive?.(row) ? 'bg-primary-fixed/40' : 'hover:bg-surface-container-low',
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'px-space-lg py-space-md align-middle',
                      ALIGN[column.align ?? 'left'],
                    )}
                  >
                    {column.render(row, index)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>

      {loading && !hasRows && (
        <div className="flex justify-center py-12 text-primary">
          <Spinner size="lg" />
        </div>
      )}
      {loading && hasRows && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-container-lowest/60 text-primary">
          <Spinner size="lg" />
        </div>
      )}
      {!loading && !hasRows && (empty ?? <EmptyState icon="inbox" title="Chưa có dữ liệu" />)}
    </div>
  );
}
