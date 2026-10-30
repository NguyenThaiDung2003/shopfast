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
import { InventoryQuery } from './dto/inventory.query';
import { ListProductsQuery } from './dto/list-products.query';
import { InventoryPageDto, ProductDetailDto, ProductPageDto } from './dto/product.response';
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
  /**
   * Tồn kho (nhân viên kho)
   *
   * Đọc thẳng DB, không qua cache. Tìm `q` theo SKU/tên, lọc `categoryId`, `stockLevel`
   * (out / low / ok so với ngưỡng LOW_STOCK_THRESHOLD). `summary` là số liệu toàn kho.
   */
  // Khai báo trước ':id' để "inventory" không bị ParseIdPipe bắt.
  @Get('inventory')
  @Roles(Role.ADMIN, Role.WAREHOUSE)
  @ApiBearerAuth('bearer')
  @ApiErrorResponses(400, 401, 403)
  inventory(@Query() query: InventoryQuery): Promise<InventoryPageDto> {
    return this.catalogService.inventory(query);
  }

  @Public()
  @Get(':id')
  @ApiErrorResponses(400, 404)
  findOne(@Param('id', ParseIdPipe) id: number): Promise<ProductDetailDto> {
    return this.catalogService.findOne(id);
  }

  /**
   * Cập nhật giá / ảnh / tồn kho
   *
   * ADMIN sửa giá, giá gốc, ảnh và tồn kho; WAREHOUSE chỉ sửa tồn kho (`stock` hoặc `stockDelta`).
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
