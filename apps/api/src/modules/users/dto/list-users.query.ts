import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListUsersQuery {
  /** Trang (bắt đầu từ 1). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  /** Số tài khoản mỗi trang (1–100). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  /** Lọc theo vai trò. */
  @ApiProperty({ description: 'Lọc theo vai trò.', enum: Role, enumName: 'Role', required: false })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
