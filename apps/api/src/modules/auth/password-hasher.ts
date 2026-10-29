import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcryptjs';
import type { EnvironmentVariables } from '../../config/env.validation';

@Injectable()
export class PasswordHasher {
  private readonly rounds: number;
  private dummyHash?: Promise<string>;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.rounds = config.get('BCRYPT_ROUNDS', { infer: true });
  }

  hash(plain: string): Promise<string> {
    return hash(plain, this.rounds);
  }

  compare(plain: string, passwordHash: string): Promise<boolean> {
    return compare(plain, passwordHash);
  }

  /**
   * So sánh với một hash giả khi email không tồn tại, để thời gian phản hồi
   * giống trường hợp sai mật khẩu – kẻ tấn công không dò được email nào đã đăng ký.
   */
  async compareDummy(plain: string): Promise<void> {
    this.dummyHash ??= hash('shopfast-timing-equalizer', this.rounds);
    await compare(plain, await this.dummyHash);
  }
}
