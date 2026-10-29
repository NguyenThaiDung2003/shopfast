import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ApiErrorResponses } from '../../common/swagger/api-error-responses.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ListUsersQuery } from './dto/list-users.query';
import { UserPageDto } from './dto/user.response';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth('bearer')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Danh sách tài khoản (chỉ ADMIN) */
  @Get()
  @Roles(Role.ADMIN)
  @ApiErrorResponses(400, 401, 403)
  list(@Query() query: ListUsersQuery): Promise<UserPageDto> {
    return this.usersService.list(query);
  }
}
