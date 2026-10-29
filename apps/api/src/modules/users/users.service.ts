import { Injectable } from '@nestjs/common';
import { Page, toPage } from '../../common/pagination';
import { ListUsersQuery } from './dto/list-users.query';
import { PublicUser, UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async list(query: ListUsersQuery): Promise<Page<PublicUser>> {
    const { page, limit, role } = query;
    const { items, total } = await this.usersRepository.findPage(
      { role },
      (page - 1) * limit,
      limit,
    );
    return toPage(items, total, page, limit);
  }
}
