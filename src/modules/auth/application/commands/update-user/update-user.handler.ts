import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import {
  PublicUser,
  toPublicUser,
} from '@/modules/auth/domain/entities/user.entity'
import { AuthErrors } from '@/modules/auth/domain/exceptions/auth.exceptions'
import { UserRepository } from '@/modules/auth/domain/repositories/user.repository'
import { UserManagementPolicy } from '@/modules/auth/domain/user-management.policy'
import { createLogger } from '@/shared/logging/root-logger'
import { UpdateUserCommand } from './update-user.command'

/**
 * Edición de datos y rol. Un cambio de rol rige desde el request siguiente del
 * usuario: el guard toma el rol de la base, no el del token.
 */
@CommandHandler(UpdateUserCommand)
export class UpdateUserHandler implements ICommandHandler<
  UpdateUserCommand,
  PublicUser
> {
  private readonly logger = createLogger('UpdateUserHandler')

  constructor(private readonly users: UserRepository) {}

  async execute(command: UpdateUserCommand): Promise<PublicUser> {
    const target = UserManagementPolicy.requireManageable(
      await this.users.findById(command.userId),
      command.userId,
    )

    const { email, firstName, lastName, role } = command.changes

    if (role !== undefined) {
      UserManagementPolicy.assertCanChangeRole(command.actorId, target, role)
    }

    if (
      email !== undefined &&
      (await this.users.existsInternalByEmail(email, target.id))
    ) {
      throw AuthErrors.emailAlreadyRegistered()
    }

    const updated = await this.users.update(target.id, {
      email,
      role,
      firstName:
        firstName === undefined
          ? undefined
          : UserManagementPolicy.normalizeName(firstName),
      lastName:
        lastName === undefined
          ? undefined
          : UserManagementPolicy.normalizeName(lastName),
    })

    this.logger.info(
      {
        operation: 'user_updated',
        updatedUserId: target.id,
        fields: Object.keys(command.changes),
      },
      'Usuario actualizado',
    )

    return toPublicUser(updated)
  }
}
