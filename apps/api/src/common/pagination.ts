export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Page<T> {
  items: T[];
  meta: PageMeta;
}

export function toPage<T>(items: T[], total: number, page: number, limit: number): Page<T> {
  return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}
