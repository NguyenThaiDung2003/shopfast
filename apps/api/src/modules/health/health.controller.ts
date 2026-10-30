import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiErrorResponses } from '../../common/swagger/api-error-responses.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { LivenessDto, ReadinessDto } from './health.response';
import { HealthService } from './health.service';

/** Ngoài tiền tố /api (`configureApp`): endpoint cho hạ tầng, không phải API nghiệp vụ. */
export const HEALTH_PATHS = ['health', 'health/live'];

@ApiTags('Health')
@Public()
// Healthcheck của Docker/Nginx/load balancer gọi liên tục, không tính vào hạn mức.
@SkipThrottle({ global: true })
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Readiness: kết nối PostgreSQL và Redis
   *
   * 200 `ok`; 200 `degraded` khi Redis lỗi (cache, rate limit, OTP tự suy giảm – vẫn nhận
   * traffic); 503 khi DB lỗi hoặc instance đang tắt (`details.status = shutting_down`).
   */
  @Get()
  @ApiOkResponse({ type: ReadinessDto })
  @ApiErrorResponses(503)
  ready(): Promise<ReadinessDto> {
    return this.healthService.ready();
  }

  /** Liveness: tiến trình còn sống (không kiểm phụ thuộc) */
  @Get('live')
  @ApiOkResponse({ type: LivenessDto })
  live(): LivenessDto {
    return this.healthService.live();
  }
}
