import { Controller, Delete, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ApiErrorResponses } from '../../common/swagger/api-error-responses.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CacheService } from './cache.service';
import { CacheStatsDto } from './dto/cache-stats.response';

@ApiTags('Admin')
@ApiBearerAuth('bearer')
@Roles(Role.ADMIN)
@Controller('admin/cache')
export class CacheController {
  constructor(private readonly cacheService: CacheService) {}

  /**
   * Tỉ lệ trúng cache (chỉ ADMIN)
   *
   * Đếm từ lần reset gần nhất, cộng dồn mọi instance API (bộ đếm nằm trong Redis).
   */
  @Get('stats')
  @ApiErrorResponses(401, 403, 503)
  stats(): Promise<CacheStatsDto> {
    return this.cacheService.getStats();
  }

  /** Đặt lại bộ đếm hit/miss (chỉ ADMIN) */
  @Delete('stats')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiErrorResponses(401, 403, 503)
  async resetStats(): Promise<void> {
    await this.cacheService.resetStats();
  }
}
