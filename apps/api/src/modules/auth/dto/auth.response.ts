import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from '../../users/dto/user.response';

export class AuthTokensDto {
  /** JWT, gửi trong header `Authorization: Bearer <accessToken>`. */
  accessToken!: string;
  /** Chuỗi đục, dùng một lần cho `POST /api/auth/refresh` (ADR-0003). */
  refreshToken!: string;
  @ApiProperty({ enum: ['Bearer'] })
  tokenType!: 'Bearer';
  /** Số giây access token còn hiệu lực. */
  expiresIn!: number;
}

export class AuthResultDto extends AuthTokensDto {
  user!: UserDto;
}

export class OtpSentDto {
  /** Số giây mã OTP còn hiệu lực. */
  expiresInSeconds!: number;
}

export class RegisterResultDto {
  /** Email đã đăng ký, cần xác minh bằng OTP trước khi đăng nhập. */
  email!: string;
  /** Số giây mã OTP còn hiệu lực; 0 nếu chưa gửi được, người dùng cần bấm gửi lại. */
  expiresInSeconds!: number;
}

export class OtpVerifiedDto {
  @ApiProperty({ enum: [true] })
  verified!: true;
}
