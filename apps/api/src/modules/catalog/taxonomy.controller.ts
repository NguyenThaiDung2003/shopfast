import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { CatalogService } from './catalog.service';
import { CatalogFacetDto } from './dto/taxonomy.response';

@ApiTags('Catalog')
@Controller()
export class TaxonomyController {
  constructor(private readonly catalogService: CatalogService) {}

  /** Danh mục sản phẩm kèm số sản phẩm, sắp theo tên */
  @Public()
  @Get('categories')
  categories(): Promise<CatalogFacetDto[]> {
    return this.catalogService.listCategories();
  }

  /** Thương hiệu kèm số sản phẩm, sắp theo tên */
  @Public()
  @Get('brands')
  brands(): Promise<CatalogFacetDto[]> {
    return this.catalogService.listBrands();
  }
}
