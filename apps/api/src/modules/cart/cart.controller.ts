import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-error-responses.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CartService } from './cart.service';
import { AddCartItemDto, UpdateCartItemDto } from './dto/cart-item.dto';
import { CartDto } from './dto/cart.response';

@ApiTags('Cart')
@ApiBearerAuth('bearer')
@Controller('cart')
@Roles(Role.CUSTOMER)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  /** Giỏ hàng của tôi */
  @Get()
  @ApiErrorResponses(401, 403)
  getCart(@CurrentUser() user: AuthUser): Promise<CartDto> {
    return this.cartService.getCart(user.id);
  }

  /** Thêm sản phẩm vào giỏ (cộng dồn nếu đã có, tối đa 99) */
  @Post('items')
  @ApiErrorResponses(400, 401, 403, 404, 409)
  addItem(@CurrentUser() user: AuthUser, @Body() dto: AddCartItemDto): Promise<CartDto> {
    return this.cartService.addItem(user.id, dto);
  }

  /** Đặt lại số lượng một sản phẩm trong giỏ */
  @Patch('items/:productId')
  @ApiErrorResponses(400, 401, 403, 404, 409)
  updateItem(
    @CurrentUser() user: AuthUser,
    @Param('productId', ParseIdPipe) productId: number,
    @Body() dto: UpdateCartItemDto,
  ): Promise<CartDto> {
    return this.cartService.updateItem(user.id, productId, dto.quantity);
  }

  /** Xoá một sản phẩm khỏi giỏ */
  @Delete('items/:productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiErrorResponses(400, 401, 403, 404)
  removeItem(
    @CurrentUser() user: AuthUser,
    @Param('productId', ParseIdPipe) productId: number,
  ): Promise<void> {
    return this.cartService.removeItem(user.id, productId);
  }

  /** Xoá hết giỏ hàng */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiErrorResponses(401, 403)
  clear(@CurrentUser() user: AuthUser): Promise<void> {
    return this.cartService.clear(user.id);
  }
}
