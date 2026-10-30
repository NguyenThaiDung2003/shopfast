import type { Role } from '../auth/roles';

export interface StaffNavItem {
  /** Đường dẫn con dưới `/quan-tri`. */
  path: string;
  label: string;
  icon: string;
  roles: readonly Role[];
}

/** Menu sidebar nhân viên – cũng là nguồn quyền cho route `/quan-tri/*`. */
export const STAFF_NAV: readonly StaffNavItem[] = [
  {
    path: 'kho/don-hang',
    label: 'Xử lý đơn kho',
    icon: 'inventory_2',
    roles: ['WAREHOUSE', 'ADMIN'],
  },
  {
    path: 'kho/ton-kho',
    label: 'Quản lý tồn kho',
    icon: 'warehouse',
    roles: ['WAREHOUSE', 'ADMIN'],
  },
  {
    path: 'cskh/ticket',
    label: 'Bàn làm việc CSKH',
    icon: 'support_agent',
    roles: ['SUPPORT', 'ADMIN'],
  },
  { path: 'he-thong', label: 'Giám sát hệ thống', icon: 'monitoring', roles: ['ADMIN'] },
];

export function staffNavFor(role: Role): StaffNavItem[] {
  return STAFF_NAV.filter((item) => item.roles.includes(role));
}
