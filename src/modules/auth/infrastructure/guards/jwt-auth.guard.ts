import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { Request } from 'express'

import { Configuration, JwtConfig } from '@/shared/config/configuration'
import { RequestContext } from '@/shared/context/request-context'
import { canSignIn } from '@/modules/auth/domain/entities/user.entity'
import { userTypeOf } from '@/modules/auth/domain/enums/role.enum'
import { AuthErrors } from '@/modules/auth/domain/exceptions/auth.exceptions'
import { UserRepository } from '@/modules/auth/domain/repositories/user.repository'
import { IS_PUBLIC_KEY } from '../decorators/is-public.decorator'
import { TokenService } from '../services/token.service'
import {
  AccessTokenPayload,
  AuthenticatedUser,
} from '../types/jwt-payload.type'

function toAuthenticatedUser(payload: AccessTokenPayload): AuthenticatedUser {
  return {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    // Del rol y no del claim: un token emitido antes de que existiera el claim
    // sigue funcionando, y los dos nunca pueden contradecirse.
    userType: userTypeOf(payload.role),
    tenantId: payload.tenantId,
  }
}

/**
 * Guard global de autenticación.
 *
 * Se registra con `APP_GUARD` en `AppModule`, así que **todos** los endpoints
 * exigen un `Authorization: Bearer <token>` salvo los marcados con
 * `@IsPublic()`. Fallar cerrado es la única forma de que un endpoint nuevo no
 * quede abierto por olvido.
 *
 * Por defecto no toca la base: el access token es corto y stateless. Si
 * necesitás revocación inmediata (banear un usuario, invalidar sesiones al
 * cambiar la contraseña), poné `JWT_VALIDATE_USER_ON_REQUEST=true` y el guard
 * verifica el usuario en cada request.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly jwtConfig: JwtConfig

  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
    private readonly userRepository: UserRepository,
    configService: ConfigService<Configuration, true>,
  ) {
    this.jwtConfig = configService.get('jwt', { infer: true })
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    const request = context.switchToHttp().getRequest<Request>()
    const token = this.extractToken(request)

    if (isPublic) {
      // En un endpoint público no exigimos token, pero si vino uno válido lo
      // usamos: sirve para endpoints que devuelven más datos si estás logueado.
      if (token) await this.tryAttachUser(request, token)
      return true
    }

    if (!token) throw AuthErrors.tokenMissing()

    const payload = await this.tokenService.verifyAccessToken(token)
    const user = toAuthenticatedUser(payload)

    // Deja el usuario en el contexto del request: desde acá lo leen el logger
    // (para estampar userId en cada línea), la auditoría (para saber quién
    // hizo cada cambio) y el filtro de tenant de Prisma, sin tener que
    // propagarlo por parámetro hasta los repositorios. Va antes de validar
    // contra la base porque esa consulta ya necesita el tenant.
    RequestContext.setUser(user)

    if (this.jwtConfig.validateUserOnRequest) {
      await this.assertUserStillValid(payload.sub, payload.iat, user)
    }

    request.user = user

    return true
  }

  /**
   * Chequea contra la base que el usuario siga habilitado y que el token no
   * sea anterior al último cambio de contraseña.
   */
  private async assertUserStillValid(
    userId: string,
    issuedAt: number | undefined,
    user: AuthenticatedUser,
  ): Promise<void> {
    const dbUser = await this.userRepository.findById(userId)

    if (!dbUser)
      throw AuthErrors.tokenInvalid({ reason: 'usuario inexistente' })
    if (!canSignIn(dbUser)) throw AuthErrors.accountInactive()

    if (dbUser.passwordChangedAt && issuedAt) {
      const changedAtSeconds = Math.floor(
        dbUser.passwordChangedAt.getTime() / 1000,
      )
      if (issuedAt < changedAtSeconds) throw AuthErrors.sessionRevoked()
    }

    // El rol pudo haber cambiado después de emitir el token: manda la base.
    user.role = dbUser.role
    user.userType = userTypeOf(dbUser.role)
    user.email = dbUser.email
  }

  /** Igual que el camino normal, pero sin romper si el token no sirve. */
  private async tryAttachUser(request: Request, token: string): Promise<void> {
    try {
      const payload = await this.tokenService.verifyAccessToken(token)
      const user = toAuthenticatedUser(payload)
      request.user = user
      RequestContext.setUser(user)
    } catch {
      // Endpoint público: un token inválido simplemente se ignora.
    }
  }

  private extractToken(request: Request): string | null {
    const header = request.headers.authorization

    if (!header) return null

    const [scheme, value] = header.split(' ')
    if (scheme?.toLowerCase() !== 'bearer' || !value?.trim()) return null

    return value.trim()
  }
}
