import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { ListProductsQuery } from './dto/list-products.query';
import { ProductListItem, ProductsRepository } from './products.repository';

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ProductPage {
  items: ProductListItem[];
  meta: PageMeta;
}

@Injectable()
export class ProductsService {
  constructor(private readonly productsRepository: ProductsRepository) {}

  async list(query: ListProductsQuery): Promise<ProductPage> {
    const { page, limit, categoryId, brandId, minPrice, maxPrice } = query;

    if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'INVALID_PRICE_RANGE',
        'Khoảng giá không hợp lệ: giá thấp nhất phải nhỏ hơn hoặc bằng giá cao nhất.',
      );
    }

    const { items, total } = await this.productsRepository.findPage(
      { categoryId, brandId, minPrice, maxPrice },
      (page - 1) * limit,
      limit,
    );

    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
