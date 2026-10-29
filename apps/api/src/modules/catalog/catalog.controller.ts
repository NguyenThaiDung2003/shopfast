import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ProductDetail } from './catalog.repository';
import { CatalogService, ProductPage } from './catalog.service';
import { ListProductsQuery } from './dto/list-products.query';
import { UpdateProductDto } from './dto/update-product.dto';

@Controller('products')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Public()
  @Get()
  list(@Query() query: ListProductsQuery): Promise<ProductPage> {
    return this.catalogService.list(query);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseIdPipe) id: number): Promise<ProductDetail> {
    return this.catalogService.findOne(id);
  }

  // Warehouse chỉ được sửa tồn kho; kiểm theo trường ở CatalogService.
  @Patch(':id')
  @Roles(Role.ADMIN, Role.WAREHOUSE)
  update(
    @Param('id', ParseIdPipe) id: number,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ProductDetail> {
    return this.catalogService.update(id, dto, user);
  }
}
