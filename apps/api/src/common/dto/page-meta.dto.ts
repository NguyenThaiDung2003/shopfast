/** Thông tin phân trang dùng chung (khớp `PageMeta` của `common/pagination.ts`). */
export class PageMetaDto {
  page!: number;
  limit!: number;
  total!: number;
  totalPages!: number;
}
