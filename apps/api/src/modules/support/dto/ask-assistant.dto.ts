import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { trimString } from './trim';

export class AskAssistantDto {
  /** Câu hỏi của nhân viên cho trợ lý AI (1–2000 ký tự). */
  @IsString()
  @Transform(trimString)
  @Length(1, 2000)
  question!: string;
}
