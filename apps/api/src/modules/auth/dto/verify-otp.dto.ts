import { Matches } from 'class-validator';
import { SendOtpDto } from './send-otp.dto';

export class VerifyOtpDto extends SendOtpDto {
  @Matches(/^\d{6}$/)
  code!: string;
}
