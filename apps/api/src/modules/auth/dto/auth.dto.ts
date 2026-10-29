import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  /** Email đăng nhập (không phân biệt hoa thường). */
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  /** Mật khẩu 8–72 ký tự, có cả chữ và số (bcrypt chỉ dùng 72 byte đầu). */
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d)/)
  password!: string;

  /** Họ tên hiển thị (2–100 ký tự). */
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2)
  @MaxLength(100)
  fullName!: string;
}

export class LoginDto {
  /** Email đăng nhập (không phân biệt hoa thường). */
  @Transform(normalizeEmail)
  @IsEmail()
  email!: string;

  /** Mật khẩu. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  password!: string;
}

export class RefreshTokenDto {
  /** Refresh token nhận được khi đăng nhập/refresh. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  refreshToken!: string;
}
