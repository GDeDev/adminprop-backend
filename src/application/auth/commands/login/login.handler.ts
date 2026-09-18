import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { ConfigService } from '@nestjs/config'

import { isLocked, toPublicUser } from '@/domain/auth/entities/user.entity'
import { AuthErrors } from '@/domain/auth/exceptions/auth.exceptions'
import { UserRepository } from '@/domain/auth/repositories/user.repository'
import { AuthTokenIssuer } from '@/infrastructure/auth/services/auth-token-issuer.service'
import { PasswordService } from '@/infrastructure/auth/services/password.service'
import { AccountLockConfig, Configuration } from '@/shared/config/configuration'
import { CustomLoggerService } from '@/shared/core/logger.service'
import { AuthResult } from '../../results/auth-result'
import { LoginCommand } from './login.command'

@CommandHandler(LoginCommand)
export class LoginHandler implements ICommandHandler<LoginCommand, AuthResult> {
  private readonly logger = new CustomLoggerService('LoginHandler')
  private readonly lockConfig: AccountLockConfig

  constructor(
    private readonly userRepository: UserRepository,
    private readonly passwordService: PasswordService,
    private readonly tokenIssuer: AuthTokenIssuer,
    configService: ConfigService<Configuration, true>,
  ) {
    this.lockConfig = configService.get<AccountLockConfig>('accountLock', {
      infer: true,
    })
  }

  async execute(command: LoginCommand): Promise<AuthResult> {
    const user = await this.userRepository.findByEmail(command.email)

    if (!user) {
      // Quemamos el mismo tiempo que un bcrypt real: si respondiéramos de una,
      // el atacante podría distinguir emails registrados de los que no.
      await this.passwordService.burnCompare(command.password)
      this.logger.warn('Login fallido: email inexistente', {
        operation: 'auth_login_failed',
        reason: 'unknown_email',
      })
      throw AuthErrors.invalidCredentials({ reason: 'unknown_email' })
    }

    if (isLocked(user)) {
      this.logger.warn('Login rechazado: cuenta bloqueada', {
        operation: 'auth_login_failed',
        reason: 'account_locked',
        userId: user.id,
      })
      throw AuthErrors.accountLocked(user.lockedUntil)
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
      this.logger.warn('Login fallido: contraseña incorrecta', {
        operation: 'auth_login_failed',
        reason: 'bad_password',
        userId: user.id,
      })
      throw AuthErrors.invalidCredentials({ reason: 'bad_password' })
    }

    // El chequeo de cuenta activa va después de validar la contraseña: si no,
    // sería otra forma de enumerar cuentas.
    if (!user.isActive) {
      this.logger.warn('Login rechazado: cuenta inactiva', {
        operation: 'auth_login_failed',
        reason: 'inactive',
        userId: user.id,
      })
      throw AuthErrors.accountInactive()
    }

    await this.userRepository.registerSuccessfulLogin(user.id)

    // Si subiste BCRYPT_SALT_ROUNDS, aprovechamos que tenemos la contraseña en
    // claro para re-hashear con el costo nuevo.
    if (this.passwordService.needsRehash(user.passwordHash)) {
      const rehashed = await this.passwordService.hash(command.password)
      await this.userRepository.rehashPassword(user.id, rehashed)
      this.logger.log('Hash de contraseña actualizado al costo actual', {
        operation: 'auth_password_rehash',
        userId: user.id,
      })
    }

    const tokens = await this.tokenIssuer.issueNewSession(user, command.context)

    this.logger.log('Login exitoso', {
      operation: 'auth_login',
      userId: user.id,
    })

    return { user: toPublicUser(user), tokens }
  }
}
