import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { normalizeEmail, PASSWORD_RULE } from './auth.dto';

export class ResetPasswordDto {
  /** Email tài khoản. */
  @Transform(normalizeEmail)
  @IsEmail()
  email!: string;

  /** Mã OTP 6 chữ số, mục đích `RESET_PASSWORD`. */
  @Matches(/^\d{6}$/)
  code!: string;

  /** Mật khẩu mới 8–72 ký tự, có cả chữ và số. */
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(PASSWORD_RULE)
  newPassword!: string;
}
