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

export class OtpVerifiedDto {
  @ApiProperty({ enum: [true] })
  verified!: true;
}
