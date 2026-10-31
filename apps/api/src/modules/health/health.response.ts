import { ApiProperty } from '@nestjs/swagger';

export class SystemVersionDto {
  /** Phiên bản bản build (APP_VERSION); `dev` khi chưa đặt. */
  version!: string;
  /** Commit của bản build (GIT_COMMIT); `unknown` khi chưa đặt. */
  commit!: string;
  /** Môi trường chạy (NODE_ENV). */
  environment!: string;
  /** Phiên bản Node.js. */
  nodeVersion!: string;
}

export class LivenessDto {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';
  /** Số giây process đã chạy. */
  uptimeSeconds!: number;
  /** Commit của bản build (GIT_COMMIT); deploy.sh dùng để biết traffic đã tới đúng bản mới. */
  commit!: string;
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
