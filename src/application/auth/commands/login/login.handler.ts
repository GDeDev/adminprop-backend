import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { ConfigService } from '@nestjs/config'

import {
  activeLockUntil,
  canSignIn,
  toPublicUser,
  User,
} from '@/domain/auth/entities/user.entity'
import { AuthErrors } from '@/domain/auth/exceptions/auth.exceptions'
import { UserRepository } from '@/domain/auth/repositories/user.repository'
import { AuthTokenIssuer } from '@/infrastructure/auth/services/auth-token-issuer.service'
import { PasswordService } from '@/infrastructure/auth/services/password.service'
import { AccountLockConfig, Configuration } from '@/shared/config/configuration'
import { RequestContext } from '@/shared/context/request-context'
import { createLogger } from '@/shared/logging/root-logger'
import { AuthResult } from '../../results/auth-result'
import { LoginCommand } from './login.command'

@CommandHandler(LoginCommand)
export class LoginHandler implements ICommandHandler<LoginCommand, AuthResult> {
  private readonly logger = createLogger('LoginHandler')
  private readonly lockConfig: AccountLockConfig

  constructor(
    private readonly userRepository: UserRepository,
    private readonly passwordService: PasswordService,
    private readonly tokenIssuer: AuthTokenIssuer,
    configService: ConfigService<Configuration, true>,
  ) {
    this.lockConfig = configService.get('accountLock', {
      infer: true,
    })
  }

  async execute(command: LoginCommand): Promise<AuthResult> {
    // Única consulta entre tenants: todavía no sabemos de qué inmobiliaria es.
    const user = await this.userRepository.findByEmail(command.email)

    if (!user) {
      // Quemamos el mismo tiempo que un bcrypt real: si respondiéramos de una,
      // el atacante podría distinguir emails registrados de los que no.
      await this.passwordService.burnCompare(command.password)
      this.logger.warn(
        {
          operation: 'auth_login_failed',
          reason: 'unknown_email',
        },
        'Login fallido: email inexistente',
      )
      throw AuthErrors.invalidCredentials({ reason: 'unknown_email' })
    }

    // Desde acá todo corre dentro del tenant del usuario: los updates de
    // intentos fallidos y de último login pasan por el filtro de tenant igual
    // que cualquier otra escritura, y la auditoría registra el tenant.
    return RequestContext.runInTenant(user.tenantId, () =>
      this.authenticate(user, command),
    )
  }

  private async authenticate(
    user: User,
    command: LoginCommand,
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
      command.password,
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
      const rehashed = await this.passwordService.hash(command.password)
      await this.userRepository.rehashPassword(user.id, rehashed)
      this.logger.info(
        {
          operation: 'auth_password_rehash',
          userId: user.id,
        },
        'Hash de contraseña actualizado al costo actual',
      )
    }

    const tokens = await this.tokenIssuer.issueNewSession(user, command.context)

    this.logger.info(
      {
        operation: 'auth_login',
        userId: user.id,
      },
      'Login exitoso',
    )

    return { user: toPublicUser(user), tokens }
  }
}
