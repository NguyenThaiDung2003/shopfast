import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'auth:roles';

/** Chỉ cho phép các vai trò được liệt kê. Đặt ở handler hoặc controller. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
