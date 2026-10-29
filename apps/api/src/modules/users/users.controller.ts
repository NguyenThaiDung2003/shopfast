import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Page } from '../../common/pagination';
import { Roles } from '../auth/decorators/roles.decorator';
import { ListUsersQuery } from './dto/list-users.query';
import { PublicUser } from './users.repository';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(Role.ADMIN)
  list(@Query() query: ListUsersQuery): Promise<Page<PublicUser>> {
    return this.usersService.list(query);
  }
}
