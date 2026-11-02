import { IsIn, Matches } from 'class-validator';
import { OtpPurpose, SendOtpDto } from './send-otp.dto';

export class VerifyOtpDto extends SendOtpDto {
  /** Chỉ `VERIFY_EMAIL`; mã `RESET_PASSWORD` dùng ở `POST /auth/password/reset`. */
  @IsIn([OtpPurpose.VERIFY_EMAIL])
  declare purpose: OtpPurpose;

  /** Mã OTP 6 chữ số. */
  @Matches(/^\d{6}$/)
  code!: string;
}
