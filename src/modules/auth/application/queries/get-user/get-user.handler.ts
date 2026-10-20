import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import {
  PublicUser,
  toPublicUser,
} from '@/modules/auth/domain/entities/user.entity'
import { UserRepository } from '@/modules/auth/domain/repositories/user.repository'
import { UserManagementPolicy } from '@/modules/auth/domain/user-management.policy'
import { GetUserQuery } from './get-user.query'

/** Un admin o empleado de la inmobiliaria. De otra: 404. */
@QueryHandler(GetUserQuery)
export class GetUserHandler implements IQueryHandler<GetUserQuery, PublicUser> {
  constructor(private readonly users: UserRepository) {}

  async execute(query: GetUserQuery): Promise<PublicUser> {
    const user = UserManagementPolicy.requireManageable(
      await this.users.findById(query.userId),
      query.userId,
    )
    return toPublicUser(user)
  }
}
