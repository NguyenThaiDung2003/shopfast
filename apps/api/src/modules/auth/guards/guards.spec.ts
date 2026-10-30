import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { TokenService } from '../token.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

function contextWith(request: Record<string, unknown>, type = 'http'): ExecutionContext {
  return {
    getType: () => type,
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function reflectorWith(metadata: Record<string, unknown>): Reflector {
  return { getAllAndOverride: (key: string) => metadata[key] } as unknown as Reflector;
}

describe('JwtAuthGuard', () => {
  const user = { id: 'u1', role: Role.CUSTOMER };
  const tokenService = {
    verifyAccessToken: jest.fn().mockResolvedValue(user),
  } as unknown as TokenService;

  it('cho qua endpoint @Public() mà không cần token', async () => {
    const guard = new JwtAuthGuard(reflectorWith({ [IS_PUBLIC_KEY]: true }), tokenService);

    await expect(guard.canActivate(contextWith({ headers: {} }))).resolves.toBe(true);
  });

  it('thiếu Bearer token → UNAUTHENTICATED', async () => {
    const guard = new JwtAuthGuard(reflectorWith({}), tokenService);

    await expect(
      guard.canActivate(contextWith({ headers: { authorization: 'Basic abc' } })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('token hợp lệ → gắn user vào request', async () => {
    const guard = new JwtAuthGuard(reflectorWith({}), tokenService);
    const request: Record<string, unknown> = { headers: { authorization: 'Bearer good' } };

    await expect(guard.canActivate(contextWith(request))).resolves.toBe(true);
    expect(request.user).toEqual(user);
  });
});

describe('RolesGuard', () => {
  it('endpoint không có @Roles() → cho qua', () => {
    const guard = new RolesGuard(reflectorWith({}));

    expect(guard.canActivate(contextWith({}))).toBe(true);
  });

  it('đúng vai trò → cho qua', () => {
    const guard = new RolesGuard(reflectorWith({ [ROLES_KEY]: [Role.ADMIN, Role.SUPPORT] }));

    expect(guard.canActivate(contextWith({ user: { id: 'a', role: Role.SUPPORT } }))).toBe(true);
  });

  it('sai vai trò → 403 FORBIDDEN_ROLE', () => {
    const guard = new RolesGuard(reflectorWith({ [ROLES_KEY]: [Role.ADMIN] }));

    expect(() =>
      guard.canActivate(contextWith({ user: { id: 'c', role: Role.CUSTOMER } })),
    ).toThrow(expect.objectContaining({ code: 'FORBIDDEN_ROLE', userMessage: expect.any(String) }));
  });
});

describe('Guard toàn cục với WebSocket', () => {
  it('JwtAuthGuard và RolesGuard bỏ qua context ws (đã xác thực tại handshake)', async () => {
    const verifyAccessToken = jest.fn();
    const jwtGuard = new JwtAuthGuard(reflectorWith({}), {
      verifyAccessToken,
    } as unknown as TokenService);
    const rolesGuard = new RolesGuard(reflectorWith({ [ROLES_KEY]: [Role.ADMIN] }));

    await expect(jwtGuard.canActivate(contextWith({ headers: {} }, 'ws'))).resolves.toBe(true);
    expect(rolesGuard.canActivate(contextWith({}, 'ws'))).toBe(true);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });
});
