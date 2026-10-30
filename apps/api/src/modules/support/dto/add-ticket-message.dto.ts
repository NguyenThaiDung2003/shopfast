import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { trimString } from './trim';

export class AddTicketMessageDto {
  /** Nội dung tin nhắn (1–5000 ký tự). */
  @IsString()
  @Transform(trimString)
  @Length(1, 5000)
  body!: string;
}
