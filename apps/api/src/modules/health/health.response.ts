import { ApiProperty } from '@nestjs/swagger';

export class LivenessDto {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';
  /** Số giây process đã chạy. */
  uptimeSeconds!: number;
}

export class DependencyCheckDto {
  @ApiProperty({ description: 'Trạng thái kết nối.', enum: ['up', 'down'] })
  status!: 'up' | 'down';
  /** Thời gian kiểm tra (ms). */
  latencyMs!: number;
}

export class DependencyChecksDto {
  /** PostgreSQL (bắt buộc: down → 503). */
  database!: DependencyCheckDto;
  /** Redis (không bắt buộc: down → degraded, vẫn 200). */
  redis!: DependencyCheckDto;
}

export class ReadinessDto {
  @ApiProperty({
    description: 'ok: mọi phụ thuộc ổn; degraded: Redis lỗi, các tính năng dùng Redis tự suy giảm.',
    enum: ['ok', 'degraded'],
  })
  status!: 'ok' | 'degraded';
  checks!: DependencyChecksDto;
  /** Số giây process đã chạy. */
  uptimeSeconds!: number;
  timestamp!: string;
}
