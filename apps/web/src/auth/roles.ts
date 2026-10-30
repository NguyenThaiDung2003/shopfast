/** Khớp enum Role của Prisma (apps/api/prisma/schema.prisma). */
export type Role = 'CUSTOMER' | 'SUPPORT' | 'WAREHOUSE' | 'ADMIN';

export const STAFF_ROLES: readonly Role[] = ['SUPPORT', 'WAREHOUSE', 'ADMIN'];

export const ROLE_LABEL: Record<Role, string> = {
  CUSTOMER: 'Khách hàng',
  SUPPORT: 'Chăm sóc khách hàng',
  WAREHOUSE: 'Kho & Vận hành',
  ADMIN: 'Quản trị hệ thống',
};

/** Trang mặc định sau khi đăng nhập. */
export const ROLE_HOME: Record<Role, string> = {
  CUSTOMER: '/',
  SUPPORT: '/quan-tri/cskh/ticket',
  WAREHOUSE: '/quan-tri/kho/don-hang',
  ADMIN: '/quan-tri/kho/don-hang',
};

export function isRole(value: unknown): value is Role {
  return value === 'CUSTOMER' || value === 'SUPPORT' || value === 'WAREHOUSE' || value === 'ADMIN';
}
