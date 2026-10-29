import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { HealthStatusDto } from './health.response';
import { HealthService } from './health.service';

@ApiTags('Health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** Kiểm tra sức khoẻ dịch vụ */
  @Get()
  check(): HealthStatusDto {
    return this.healthService.check();
  }
}
