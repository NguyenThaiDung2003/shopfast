import { ApiProperty } from '@nestjs/swagger';

export class HealthStatusDto {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';
  /** Số giây process đã chạy. */
  uptimeSeconds!: number;
  timestamp!: string;
}
