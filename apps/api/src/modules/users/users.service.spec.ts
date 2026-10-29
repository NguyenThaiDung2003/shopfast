import { Role } from '@prisma/client';
import { ListUsersQuery } from './dto/list-users.query';
import { PublicUser, UsersRepository } from './users.repository';
import { UsersService } from './users.service';

const admin: PublicUser = {
  id: '6f1c0d43-6a43-4d5f-9d1c-111111111111',
  email: 'admin01@shopfast.local',
  fullName: 'Nguyễn An',
  role: Role.ADMIN,
  createdAt: new Date('2026-10-01T00:00:00Z'),
};

describe('UsersService', () => {
  let repository: jest.Mocked<Pick<UsersRepository, 'findPage'>>;
  let service: UsersService;

  beforeEach(() => {
    repository = { findPage: jest.fn().mockResolvedValue({ items: [admin], total: 25 }) };
    service = new UsersService(repository as unknown as UsersRepository);
  });

  it('phân trang và lọc theo vai trò', async () => {
    const query = Object.assign(new ListUsersQuery(), { page: 2, limit: 10, role: Role.ADMIN });

    const result = await service.list(query);

    expect(repository.findPage).toHaveBeenCalledWith({ role: Role.ADMIN }, 10, 10);
    expect(result.meta).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3 });
    expect(result.items[0]).not.toHaveProperty('passwordHash');
  });
});
