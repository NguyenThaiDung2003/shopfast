import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ApiErrorResponses } from '../../common/swagger/api-error-responses.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { SystemVersionDto } from './health.response';
import { HealthService } from './health.service';

@ApiTags('Admin')
@ApiBearerAuth('bearer')
@Roles(Role.ADMIN)
@Controller('admin/system')
export class SystemController {
  constructor(private readonly healthService: HealthService) {}

  /** Phiên bản bản build đang chạy (chỉ ADMIN) */
  @Get('version')
  @ApiErrorResponses(401, 403)
  version(): SystemVersionDto {
    return this.healthService.version();
  }
}
