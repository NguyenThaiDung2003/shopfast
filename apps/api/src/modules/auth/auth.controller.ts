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
import {
  AuthResultDto,
  AuthTokensDto,
  OtpSentDto,
  OtpVerifiedDto,
  RegisterResultDto,
} from './dto/auth.response';
import { ResetPasswordDto } from './dto/reset-password.dto';
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

  /**
   * Đăng ký tài khoản khách hàng (luôn là CUSTOMER)
   *
   * Không cấp token: gửi OTP tới email, xác minh xong mới đăng nhập được (ADR-0017).
   */
  @Public()
  @RateLimit('register')
  @Post('register')
  @ApiErrorResponses(400, 409, 429)
  register(@Body() dto: RegisterDto): Promise<RegisterResultDto> {
    return this.authService.register(dto);
  }

  /**
   * Đăng nhập, nhận access token (15 phút) và refresh token (7 ngày)
   *
   * Hạn mức riêng theo IP. Sai mật khẩu nhiều lần liên tiếp (theo email) → tạm khoá tăng dần
   * 1 → 5 → 30 phút, trả 429 `LOGIN_LOCKED` kèm `Retry-After` (ADR-0008).
   * Đúng mật khẩu nhưng chưa xác minh email → 403 `EMAIL_NOT_VERIFIED`.
   */
  @Public()
  @RateLimit('login')
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiErrorResponses(400, 401, 403, 429)
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

  /**
   * Gửi mã OTP qua email
   *
   * Luôn trả 202 để không lộ email nào có tài khoản; chỉ tài khoản đủ điều kiện mới nhận thư,
   * mỗi email 30 giây một lần.
   */
  @Public()
  @RateLimit('otpSend')
  @Post('otp/send')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiErrorResponses(400, 429, 503)
  sendOtp(@Body() dto: SendOtpDto): Promise<OtpSentDto> {
    return this.otpService.send(dto);
  }

  /** Xác minh email bằng mã OTP (dùng một lần, tối đa 5 lần nhập sai) */
  @Public()
  @RateLimit('otpVerify')
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiErrorResponses(400, 429, 503)
  verifyOtp(@Body() dto: VerifyOtpDto): Promise<OtpVerifiedDto> {
    return this.authService.verifyEmail(dto);
  }

  /** Đặt lại mật khẩu bằng mã OTP, thu hồi mọi phiên đăng nhập của tài khoản */
  @Public()
  @RateLimit('otpVerify')
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiErrorResponses(400, 429, 503)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.authService.resetPassword(dto);
  }
}
