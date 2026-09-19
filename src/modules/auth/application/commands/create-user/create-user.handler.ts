import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import {
  PublicUser,
  toPublicUser,
} from '@/modules/auth/domain/entities/user.entity'
import { AuthErrors } from '@/modules/auth/domain/exceptions/auth.exceptions'
import { UserRepository } from '@/modules/auth/domain/repositories/user.repository'
import { UserManagementPolicy } from '@/modules/auth/domain/user-management.policy'
import { PasswordService } from '@/modules/auth/infrastructure/services/password.service'
import { createLogger } from '@/shared/logging/root-logger'
import { CreateUserCommand } from './create-user.command'

/**
 * Alta de un admin o empleado en la inmobiliaria del admin que lo crea.
 *
 * El admin define la contraseña inicial y se la pasa a la persona (spec Fase
 * 4, 3.6: "invitación por email o password directo, a decidir"). La
 * invitación por email llega cuando haya proveedor real de email (Fase 14).
 */
@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements ICommandHandler<
  CreateUserCommand,
  PublicUser
> {
  private readonly logger = createLogger('CreateUserHandler')

  constructor(
    private readonly users: UserRepository,
    private readonly passwordService: PasswordService,
  ) {}

  async execute(command: CreateUserCommand): Promise<PublicUser> {
    // Global: el email de un usuario interno no se repite ni en otra
    // inmobiliaria, porque el login del backoffice no pide cuál.
    if (await this.users.existsInternalByEmail(command.email)) {
      throw AuthErrors.emailAlreadyRegistered()
    }

    const user = await this.users.create({
      email: command.email,
      passwordHash: await this.passwordService.hash(command.password),
      firstName: UserManagementPolicy.normalizeName(command.firstName),
      lastName: UserManagementPolicy.normalizeName(command.lastName),
      role: command.role,
    })

    this.logger.info(
      { operation: 'user_created', createdUserId: user.id, role: user.role },
      'Usuario creado',
    )

    return toPublicUser(user)
  }
}
