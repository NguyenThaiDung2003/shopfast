import { Transform } from 'class-transformer';
import { IsEmail, IsEnum } from 'class-validator';
import { normalizeEmail } from './auth.dto';

export enum OtpPurpose {
  VERIFY_EMAIL = 'VERIFY_EMAIL',
  RESET_PASSWORD = 'RESET_PASSWORD',
}

export class SendOtpDto {
  /** Email nhận mã. */
  @Transform(normalizeEmail)
  @IsEmail()
  email!: string;

  /** Mục đích của mã OTP. */
  @IsEnum(OtpPurpose)
  purpose!: OtpPurpose;
}
