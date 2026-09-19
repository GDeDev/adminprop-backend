import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import {
  activeLockUntil,
  canSignIn,
  toPublicUser,
  User,
} from '@/modules/auth/domain/entities/user.entity'
import { AuthErrors } from '@/modules/auth/domain/exceptions/auth.exceptions'
import { UserRepository } from '@/modules/auth/domain/repositories/user.repository'
import { AuthTokenIssuer } from '@/modules/auth/infrastructure/services/auth-token-issuer.service'
import { PasswordService } from '@/modules/auth/infrastructure/services/password.service'
import { AccountLockConfig, Configuration } from '@/shared/config/configuration'
import { createLogger } from '@/shared/logging/root-logger'
import { AuthResult, SessionContext } from '../results/auth-result'

/**
 * Lo común a los dos logins (backoffice y portal) una vez que se encontró —o
 * no— al usuario: bloqueo por intentos, contraseña, cuenta habilitada y
 * emisión de tokens.
 *
 * Cada login decide cómo buscar al usuario; lo que pasa después tiene que ser
 * idéntico, o uno de los dos terminaría siendo el camino fácil para un ataque.
 */
@Injectable()
export class SignInService {
  private readonly logger = createLogger('SignInService')
  private readonly lockConfig: AccountLockConfig

  constructor(
    private readonly userRepository: UserRepository,
    private readonly passwordService: PasswordService,
    private readonly tokenIssuer: AuthTokenIssuer,
    configService: ConfigService<Configuration, true>,
  ) {
    this.lockConfig = configService.get('accountLock', { infer: true })
  }

  /**
   * Rechaza un login cuyo usuario no se encontró, tardando lo mismo que uno
   * real: si respondiéramos de una, el atacante podría distinguir cuentas que
   * existen de las que no.
   */
  async rejectUnknown(
    password: string,
    reason: string,
    metadata: Record<string, unknown> = {},
  ): Promise<never> {
    await this.passwordService.burnCompare(password)
    this.logger.warn(
      { operation: 'auth_login_failed', reason, ...metadata },
      'Login fallido: usuario inexistente',
    )
    throw AuthErrors.invalidCredentials({ reason })
  }

  /**
   * Valida la contraseña del usuario encontrado y abre la sesión.
   *
   * Tiene que correr dentro del tenant del usuario: los updates de intentos
   * fallidos y de último login pasan por el filtro de tenant igual que
   * cualquier otra escritura, y la auditoría registra el tenant.
   */
  async authenticate(
    user: User,
    password: string,
    context: SessionContext,
  ): Promise<AuthResult> {
    const lockedUntil = activeLockUntil(user)
    if (lockedUntil) {
      this.logger.warn(
        {
          operation: 'auth_login_failed',
          reason: 'account_locked',
          userId: user.id,
        },
        'Login rechazado: cuenta bloqueada',
      )
      throw AuthErrors.accountLocked(lockedUntil)
    }

    const passwordMatches = await this.passwordService.compare(
      password,
      user.passwordHash,
    )

    if (!passwordMatches) {
      await this.userRepository.registerFailedLogin(
        user.id,
        this.lockConfig.maxFailedAttempts,
        this.lockConfig.lockDurationMs,
      )
      this.logger.warn(
        {
          operation: 'auth_login_failed',
          reason: 'bad_password',
          userId: user.id,
        },
        'Login fallido: contraseña incorrecta',
      )
      throw AuthErrors.invalidCredentials({ reason: 'bad_password' })
    }

    // El chequeo de cuenta activa va después de validar la contraseña: si no,
    // sería otra forma de enumerar cuentas. Una inmobiliaria deshabilitada
    // cuenta igual que una cuenta deshabilitada, con el mismo mensaje.
    if (!canSignIn(user)) {
      this.logger.warn(
        {
          operation: 'auth_login_failed',
          reason: user.isActive ? 'tenant_inactive' : 'inactive',
          userId: user.id,
        },
        'Login rechazado: cuenta inactiva',
      )
      throw AuthErrors.accountInactive()
    }

    await this.userRepository.registerSuccessfulLogin(user.id)

    // Si subiste BCRYPT_SALT_ROUNDS, aprovechamos que tenemos la contraseña en
    // claro para re-hashear con el costo nuevo.
    if (this.passwordService.needsRehash(user.passwordHash)) {
      const rehashed = await this.passwordService.hash(password)
      await this.userRepository.rehashPassword(user.id, rehashed)
      this.logger.info(
        { operation: 'auth_password_rehash', userId: user.id },
        'Hash de contraseña actualizado al costo actual',
      )
    }

    const tokens = await this.tokenIssuer.issueNewSession(user, context)

    this.logger.info(
      { operation: 'auth_login', userId: user.id, role: user.role },
      'Login exitoso',
    )

    return { user: toPublicUser(user), tokens }
  }
}
