import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import {
  PublicUser,
  toPublicUser,
} from '@/modules/auth/domain/entities/user.entity'
import { AuthErrors } from '@/modules/auth/domain/exceptions/auth.exceptions'
import { UserRepository } from '@/modules/auth/domain/repositories/user.repository'
import { GetProfileQuery } from './get-profile.query'

@QueryHandler(GetProfileQuery)
export class GetProfileHandler implements IQueryHandler<
  GetProfileQuery,
  PublicUser
> {
  constructor(private readonly userRepository: UserRepository) {}

  async execute(query: GetProfileQuery): Promise<PublicUser> {
    const user = await this.userRepository.findById(query.userId)

    if (!user) throw AuthErrors.tokenInvalid({ reason: 'usuario inexistente' })

    return toPublicUser(user)
  }
}
