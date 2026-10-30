import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { trimString } from './trim';

export class DecidePendingActionDto {
  /** Ghi chú của người xác nhận hoặc từ chối. */
  @IsOptional()
  @IsString()
  @Transform(trimString)
  @MaxLength(500)
  note?: string;
}
