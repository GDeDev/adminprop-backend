import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { Request } from 'express'

import { ChangePasswordCommand } from '@/application/auth/commands/change-password/change-password.command'
import { ChangePasswordResult } from '@/application/auth/commands/change-password/change-password.handler'
import { LoginCommand } from '@/application/auth/commands/login/login.command'
import { LogoutAllCommand } from '@/application/auth/commands/logout-all/logout-all.command'
import { LogoutAllResult } from '@/application/auth/commands/logout-all/logout-all.handler'
import { LogoutCommand } from '@/application/auth/commands/logout/logout.command'
import { RefreshTokenCommand } from '@/application/auth/commands/refresh-token/refresh-token.command'
import { RegisterCommand } from '@/application/auth/commands/register/register.command'
import { GetProfileQuery } from '@/application/auth/queries/get-profile/get-profile.query'
import { AuthResult, AuthTokens } from '@/application/auth/results/auth-result'
import { PublicUser } from '@/domain/auth/entities/user.entity'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { ThrottleAuth } from '@/shared/infra/throttler/throttle-auth.decorator'
import { CurrentUser } from '../../decorators/current-user.decorator'
import { IsPublic } from '../../decorators/is-public.decorator'
import { AuthenticatedUser } from '../../types/jwt-payload.type'
import {
  AuthResultDto,
  AuthTokensDto,
  PublicUserDto,
  RevokedSessionsDto,
} from '../dtos/auth-response.dto'
import { ChangePasswordDto } from '../dtos/change-password.dto'
import { LoginDto } from '../dtos/login.dto'
import { RefreshTokenDto } from '../dtos/refresh-token.dto'
import { RegisterDto } from '../dtos/register.dto'
import { sessionContextFrom } from '../session-context'

/**
 * Autenticación con JWT: access token corto + refresh token rotativo.
 *
 * Flujo esperado del cliente:
 *  1. `POST /auth/login` → guardar los dos tokens.
 *  2. Mandar `Authorization: Bearer <accessToken>` en cada request.
 *  3. Ante un 401 con `code: "TOKEN_EXPIRED"`, llamar a `POST /auth/refresh`
 *     y **reemplazar los dos tokens** (el refresh también cambia).
 *  4. Ante un 401 con `code: "REFRESH_TOKEN_REUSED"` o `"REFRESH_TOKEN_EXPIRED"`,
 *     mandar al usuario de vuelta al login.
 */
@ApiTags('Auth')
@Controller({ path: 'auth' })
@ApiResponse({
  status: 429,
  description: 'Demasiadas solicitudes. Mirá el header Retry-After.',
  type: ApiErrorDto,
})
export class AuthController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @IsPublic()
  @ThrottleAuth()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar un usuario',
    description:
      'Crea la cuenta y devuelve la sesión iniciada. El rol asignado es USER.',
  })
  @ApiResponse({
    status: 201,
    description: 'Usuario creado',
    type: AuthResultDto,
  })
  @ApiResponse({
    status: 409,
    description: 'El email ya está registrado',
    type: ApiErrorDto,
  })
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
  ): Promise<ApiSuccessDto<AuthResult>> {
    const result = await this.commandBus.execute<RegisterCommand, AuthResult>(
      new RegisterCommand(
        dto.email,
        dto.password,
        dto.firstName,
        dto.lastName,
        sessionContextFrom(request),
      ),
    )

    return {
      success: true,
      message: 'Cuenta creada correctamente',
      data: result,
    }
  }

  @IsPublic()
  @ThrottleAuth()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión' })
  @ApiResponse({
    status: 200,
    description: 'Sesión iniciada',
    type: AuthResultDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Credenciales inválidas',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Cuenta inactiva o bloqueada por intentos fallidos',
    type: ApiErrorDto,
  })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
  ): Promise<ApiSuccessDto<AuthResult>> {
    const result = await this.commandBus.execute<LoginCommand, AuthResult>(
      new LoginCommand(dto.email, dto.password, sessionContextFrom(request)),
    )

    return { success: true, message: 'Sesión iniciada', data: result }
  }

  @IsPublic()
  @ThrottleAuth()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Renovar el access token',
    description:
      'Devuelve un par nuevo de tokens. El refresh token enviado queda invalidado: ' +
      'guardá siempre el último. Reusar uno viejo cierra todas las sesiones.',
  })
  @ApiResponse({
    status: 200,
    description: 'Tokens renovados',
    type: AuthTokensDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Refresh token inválido, vencido o reusado',
    type: ApiErrorDto,
  })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() request: Request,
  ): Promise<ApiSuccessDto<AuthTokens>> {
    const tokens = await this.commandBus.execute<
      RefreshTokenCommand,
      AuthTokens
    >(new RefreshTokenCommand(dto.refreshToken, sessionContextFrom(request)))

    return { success: true, message: 'Tokens renovados', data: tokens }
  }

  @IsPublic()
  @ThrottleAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Cerrar la sesión actual',
    description:
      'Revoca el refresh token enviado. Es idempotente: siempre responde 204, ' +
      'incluso con un token ya vencido o inexistente. El access token sigue ' +
      'siendo válido hasta que expire.',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({ status: 204, description: 'Sesión cerrada' })
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.commandBus.execute<LogoutCommand, void>(
      new LogoutCommand(dto.refreshToken),
    )
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cerrar sesión en todos los dispositivos',
    description: 'Revoca todos los refresh tokens del usuario autenticado.',
  })
  @ApiResponse({
    status: 200,
    description: 'Sesiones cerradas',
    type: RevokedSessionsDto,
  })
  async logoutAll(
    @CurrentUser('id') userId: string,
  ): Promise<ApiSuccessDto<LogoutAllResult>> {
    const result = await this.commandBus.execute<
      LogoutAllCommand,
      LogoutAllResult
    >(new LogoutAllCommand(userId))

    return {
      success: true,
      message: `Se cerraron ${result.revokedSessions} sesión(es)`,
      data: result,
    }
  }

  @ApiBearerAuth()
  @ThrottleAuth()
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cambiar la contraseña',
    description:
      'Cierra todas las sesiones, incluida la actual. Hay que volver a iniciar sesión.',
  })
  @ApiResponse({
    status: 200,
    description: 'Contraseña actualizada',
    type: RevokedSessionsDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'La contraseña actual es incorrecta o la nueva es igual a la vigente',
    type: ApiErrorDto,
  })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ): Promise<ApiSuccessDto<ChangePasswordResult>> {
    const result = await this.commandBus.execute<
      ChangePasswordCommand,
      ChangePasswordResult
    >(new ChangePasswordCommand(userId, dto.currentPassword, dto.newPassword))

    return {
      success: true,
      message: 'Contraseña actualizada. Volvé a iniciar sesión.',
      data: result,
    }
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Datos del usuario autenticado' })
  @ApiResponse({
    status: 200,
    description: 'Perfil del usuario',
    type: PublicUserDto,
  })
  @ApiResponse({
    status: 401,
    description: 'No autenticado',
    type: ApiErrorDto,
  })
  async me(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessDto<PublicUser>> {
    const profile = await this.queryBus.execute<GetProfileQuery, PublicUser>(
      new GetProfileQuery(user.id),
    )

    return { success: true, message: null, data: profile }
  }
}
