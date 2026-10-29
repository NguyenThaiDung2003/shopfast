import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { PublicUser } from '../users/users.repository';
import { AuthService } from './auth.service';
import type { AuthResult, AuthTokens, AuthUser, ClientContext } from './auth.types';
import { ClientInfo, CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { LoginDto, RefreshTokenDto, RegisterDto } from './dto/auth.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { OtpService } from './otp.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly otpService: OtpService,
  ) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto, @ClientInfo() client: ClientContext): Promise<AuthResult> {
    return this.authService.register(dto, client);
  }

  // F03 sẽ gắn rate limit chặt hơn cho endpoint này.
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @ClientInfo() client: ClientContext): Promise<AuthResult> {
    return this.authService.login(dto, client);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto, @ClientInfo() client: ClientContext): Promise<AuthTokens> {
    return this.authService.refresh(dto.refreshToken, client);
  }

  // Public để vẫn đăng xuất được khi access token đã hết hạn.
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Body() dto: RefreshTokenDto): Promise<void> {
    return this.authService.logout(dto.refreshToken);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  logoutAll(@CurrentUser() user: AuthUser): Promise<void> {
    return this.authService.logoutAll(user.id);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<PublicUser> {
    return this.authService.me(user.id);
  }

  // F03 sẽ gắn rate limit chặt hơn cho endpoint này.
  @Public()
  @Post('otp/send')
  @HttpCode(HttpStatus.ACCEPTED)
  sendOtp(@Body() dto: SendOtpDto): Promise<{ expiresInSeconds: number }> {
    return this.otpService.send(dto);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body() dto: VerifyOtpDto): Promise<{ verified: true }> {
    return this.otpService.verify(dto);
  }
}
