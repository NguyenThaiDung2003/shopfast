import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { trimString } from './trim';

export class CreateTicketDto {
  /** Tiêu đề ngắn (1–200 ký tự). */
  @IsString()
  @Transform(trimString)
  @Length(1, 200)
  subject!: string;

  /** Nội dung tin nhắn đầu tiên (1–5000 ký tự). */
  @IsString()
  @Transform(trimString)
  @Length(1, 5000)
  message!: string;

  /** Id đơn liên quan (tuỳ chọn); phải là đơn của chính bạn. */
  @IsOptional()
  @IsUUID()
  orderId?: string;
}
