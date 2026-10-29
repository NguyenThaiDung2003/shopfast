import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PageMetaDto } from '../../../common/dto/page-meta.dto';

/** Thông tin user an toàn để trả ra ngoài (không bao giờ có passwordHash). */
export class UserDto {
  id!: string;
  email!: string;
  fullName!: string;
  @ApiProperty({ description: 'Vai trò tài khoản.', enum: Role, enumName: 'Role' })
  role!: Role;
  createdAt!: Date;
}

export class UserPageDto {
  items!: UserDto[];
  meta!: PageMetaDto;
}
