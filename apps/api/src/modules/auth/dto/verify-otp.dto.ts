import { Matches } from 'class-validator';
import { SendOtpDto } from './send-otp.dto';

export class VerifyOtpDto extends SendOtpDto {
  /** Mã OTP 6 chữ số. */
  @Matches(/^\d{6}$/)
  code!: string;
}
