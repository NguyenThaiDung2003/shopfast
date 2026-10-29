import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { ListProductsQuery } from './dto/list-products.query';
import { ProductPage, ProductsService } from './products.service';

@Public()
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  list(@Query() query: ListProductsQuery): Promise<ProductPage> {
    return this.productsService.list(query);
  }
}
