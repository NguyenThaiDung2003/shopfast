import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/swagger/api-error-responses.decorator';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { UserDto } from '../users/dto/user.response';
import { AuthService } from './auth.service';
import type { AuthUser, ClientContext } from './auth.types';
import { ClientInfo, CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { LoginDto, RefreshTokenDto, RegisterDto } from './dto/auth.dto';
import { AuthResultDto, AuthTokensDto, OtpSentDto, OtpVerifiedDto } from './dto/auth.response';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { OtpService } from './otp.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly otpService: OtpService,
  ) {}

  /** Đăng ký tài khoản khách hàng (luôn là CUSTOMER) */
  @Public()
  @Post('register')
  @ApiErrorResponses(400, 409)
  register(@Body() dto: RegisterDto, @ClientInfo() client: ClientContext): Promise<AuthResultDto> {
    return this.authService.register(dto, client);
  }

  /**
   * Đăng nhập, nhận access token (15 phút) và refresh token (7 ngày)
   *
   * Hạn mức riêng theo IP. Sai mật khẩu nhiều lần liên tiếp (theo email) → tạm khoá tăng dần
   * 1 → 5 → 30 phút, trả 429 `LOGIN_LOCKED` kèm `Retry-After` (ADR-0008).
   */
  @Public()
  @RateLimit('login')
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiErrorResponses(400, 401, 429)
  login(@Body() dto: LoginDto, @ClientInfo() client: ClientContext): Promise<AuthResultDto> {
    return this.authService.login(dto, client);
  }

  /** Đổi refresh token lấy cặp token mới (token cũ bị thu hồi) */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiErrorResponses(400, 401)
  refresh(
    @Body() dto: RefreshTokenDto,
    @ClientInfo() client: ClientContext,
  ): Promise<AuthTokensDto> {
    return this.authService.refresh(dto.refreshToken, client);
  }

  /** Đăng xuất thiết bị hiện tại (thu hồi phiên của refresh token) */
  // Public để vẫn đăng xuất được khi access token đã hết hạn.
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  logout(@Body() dto: RefreshTokenDto): Promise<void> {
    return this.authService.logout(dto.refreshToken);
  }

  /** Đăng xuất mọi thiết bị */
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('bearer')
  @ApiNoContentResponse()
  @ApiErrorResponses(401)
  logoutAll(@CurrentUser() user: AuthUser): Promise<void> {
    return this.authService.logoutAll(user.id);
  }

  /** Thông tin tài khoản hiện tại */
  @Get('me')
  @ApiBearerAuth('bearer')
  @ApiErrorResponses(401)
  me(@CurrentUser() user: AuthUser): Promise<UserDto> {
    return this.authService.me(user.id);
  }

  /** Gửi mã OTP (giả lập – mã in ra log api ở môi trường dev) */
  @Public()
  @RateLimit('otpSend')
  @Post('otp/send')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiErrorResponses(400, 429, 503)
  sendOtp(@Body() dto: SendOtpDto): Promise<OtpSentDto> {
    return this.otpService.send(dto);
  }

  /** Xác thực mã OTP (dùng một lần, tối đa 5 lần nhập sai) */
  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiErrorResponses(400, 429, 503)
  verifyOtp(@Body() dto: VerifyOtpDto): Promise<OtpVerifiedDto> {
    return this.otpService.verify(dto);
  }
}
