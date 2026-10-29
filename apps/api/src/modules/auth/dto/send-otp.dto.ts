import { Transform } from 'class-transformer';
import { IsEmail, IsEnum } from 'class-validator';
import { normalizeEmail } from './auth.dto';

export enum OtpPurpose {
  VERIFY_EMAIL = 'VERIFY_EMAIL',
  RESET_PASSWORD = 'RESET_PASSWORD',
}

export class SendOtpDto {
  @Transform(normalizeEmail)
  @IsEmail()
  email!: string;

  @IsEnum(OtpPurpose)
  purpose!: OtpPurpose;
}
