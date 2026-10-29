import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, Role, User } from '@prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';

const publicUserSelect = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

/** Thông tin user an toàn để trả ra ngoài (không có passwordHash). */
export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

export function toPublicUser({ id, email, fullName, role, createdAt }: User): PublicUser {
  return { id, email, fullName, role, createdAt };
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  fullName: string;
}

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Trả cả passwordHash – chỉ dùng cho xác thực. */
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<PublicUser | null> {
    return this.prisma.user.findUnique({ where: { id }, select: publicUserSelect });
  }

  async create(input: CreateUserInput): Promise<PublicUser> {
    try {
      return await this.prisma.user.create({
        data: { ...input, role: Role.CUSTOMER },
        select: publicUserSelect,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException(
          HttpStatus.CONFLICT,
          'EMAIL_ALREADY_EXISTS',
          'Email này đã được đăng ký.',
        );
      }
      throw error;
    }
  }

  async findPage(
    filter: { role?: Role },
    skip: number,
    take: number,
  ): Promise<{ items: PublicUser[]; total: number }> {
    const where: Prisma.UserWhereInput = { role: filter.role };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: publicUserSelect,
        orderBy: { createdAt: 'asc' },
        skip,
        take,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total };
  }
}
