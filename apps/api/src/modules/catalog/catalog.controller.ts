import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-error-responses.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CatalogService } from './catalog.service';
import { ListProductsQuery } from './dto/list-products.query';
import { ProductDetailDto, ProductPageDto } from './dto/product.response';
import { UpdateProductDto } from './dto/update-product.dto';

@ApiTags('Catalog')
@Controller('products')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  /** Danh sách sản phẩm: lọc, sắp xếp, phân trang */
  @Public()
  @Get()
  @ApiErrorResponses(400)
  list(@Query() query: ListProductsQuery): Promise<ProductPageDto> {
    return this.catalogService.list(query);
  }

  /** Chi tiết sản phẩm */
  @Public()
  @Get(':id')
  @ApiErrorResponses(400, 404)
  findOne(@Param('id', ParseIdPipe) id: number): Promise<ProductDetailDto> {
    return this.catalogService.findOne(id);
  }

  /**
   * Cập nhật giá / tồn kho
   *
   * ADMIN sửa giá và tồn kho; WAREHOUSE chỉ sửa tồn kho (`stock` hoặc `stockDelta`).
   * Phát event `product.updated`.
   */
  // Warehouse chỉ được sửa tồn kho; kiểm theo trường ở CatalogService.
  @Patch(':id')
  @Roles(Role.ADMIN, Role.WAREHOUSE)
  @ApiBearerAuth('bearer')
  @ApiErrorResponses(400, 401, 403, 404, 409)
  update(
    @Param('id', ParseIdPipe) id: number,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ProductDetailDto> {
    return this.catalogService.update(id, dto, user);
  }
}
