/** Dùng với `@Transform`: bỏ khoảng trắng đầu/cuối của chuỗi, giữ nguyên giá trị khác. */
export const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
