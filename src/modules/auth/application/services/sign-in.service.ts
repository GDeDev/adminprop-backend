import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import {
  activeLockUntil,
  canSignIn,
  toPublicUser,
  User,
} from '@/modules/auth/domain/entities/user.entity'
import { PortalRole } from '@/modules/auth/domain/enums/role.enum'
import { RequestContext } from '@/shared/context/request-context'
import { AuthErrors } from '@/modules/auth/domain/exceptions/auth.exceptions'
import { UserRepository } from '@/modules/auth/domain/repositories/user.repository'
import { AuditFacade, actorKindOf } from '@/modules/audit/public'
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
    private readonly audit: AuditFacade,
    configService: ConfigService<Configuration, true>,
  ) {
    this.lockConfig = configService.get('accountLock', { infer: true })
  }

  /**
   * Tope de filas de auditoría por IP para logins de usuarios inexistentes.
   * Cada fila guarda un email que escribió el atacante, y el throttle de login
   * limita la frecuencia pero no el volumen acumulado: sin este tope una IP (o
   * muchas) llenaba `audit_logs` sin límite. Pasado el tope el intento se sigue
   * rechazando y logueando, sólo que no se persiste.
   */
  private static readonly UNKNOWN_ATTEMPTS_WINDOW_MS = 15 * 60 * 1000
  private static readonly UNKNOWN_ATTEMPTS_MAX_ROWS = 10

  private async mayRecordUnknownAttempt(ip?: string | null): Promise<boolean> {
    const since = new Date(
      Date.now() - SignInService.UNKNOWN_ATTEMPTS_WINDOW_MS,
    )
    try {
      const recent = await this.audit.countGlobalSince(
        'LOGIN_FAILED',
        ip ?? null,
        since,
      )
      return recent < SignInService.UNKNOWN_ATTEMPTS_MAX_ROWS
    } catch {
      // Contar es un lujo: si falla, se registra como antes.
      return true
    }
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
    attempt?: {
      email: string
      context: SessionContext
      portalRole?: PortalRole
    },
  ): Promise<never> {
    await this.passwordService.burnCompare(password)
    if (attempt && (await this.mayRecordUnknownAttempt(attempt.context.ip))) {
      await this.audit.record({
        action: 'LOGIN_FAILED',
        entity: 'User',
        summary: 'Intento de acceso fallido: usuario inexistente',
        changes: { reason: { after: reason } },
        // Sin inmobiliaria conocida la fila es global: no la ve ninguna.
        tenantId: RequestContext.tenantId ?? null,
        userId: null,
        userEmail: attempt.email,
        ip: attempt.context.ip ?? null,
        actorKind: attempt.portalRole
          ? actorKindOf(attempt.portalRole, true)
          : 'SYSTEM',
      })
    }
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
      await this.recordFailure(user, context, 'account_locked')
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
      await this.recordFailure(user, context, 'bad_password')
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

    // Cuenta o inmobiliaria deshabilitada: el mismo 401 genérico que una
    // contraseña incorrecta (spec Fase 4, casos borde). Un mensaje distinto le
    // confirmaría a quien prueba que la contraseña era la correcta. Va después
    // de validar la contraseña para gastar el mismo tiempo de bcrypt.
    if (!canSignIn(user)) {
      const reason = user.isActive ? 'tenant_inactive' : 'inactive'
      await this.recordFailure(user, context, reason)
      this.logger.warn(
        { operation: 'auth_login_failed', reason, userId: user.id },
        'Login rechazado: cuenta inactiva',
      )
      throw AuthErrors.invalidCredentials({ reason })
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

    await this.audit.record({
      action: 'LOGIN',
      entity: 'User',
      entityId: user.id,
      summary: 'Inició sesión',
      ...this.actorOf(user, context),
    })

    this.logger.info(
      { operation: 'auth_login', userId: user.id, role: user.role },
      'Login exitoso',
    )

    return { user: toPublicUser(user), tokens }
  }

  private async recordFailure(
    user: User,
    context: SessionContext,
    reason: string,
  ): Promise<void> {
    await this.audit.record({
      action: 'LOGIN_FAILED',
      entity: 'User',
      entityId: user.id,
      summary: 'Intento de acceso fallido',
      changes: { reason: { after: reason } },
      ...this.actorOf(user, context),
    })
  }

  /** Quién es y desde dónde: el login todavía no tiene `RequestContext` de usuario. */
  private actorOf(user: User, context: SessionContext) {
    return {
      tenantId: user.tenantId,
      userId: user.id,
      userEmail: user.email,
      ip: context.ip ?? null,
      actorKind: actorKindOf(user.role, true),
    }
  }
}
