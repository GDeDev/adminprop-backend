import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import {
  PublicUser,
  toPublicUser,
} from '@/modules/auth/domain/entities/user.entity'
import { UserRepository } from '@/modules/auth/domain/repositories/user.repository'
import { PaginatedResult } from '@/shared/pagination'
import { paginateWith } from '@/shared/pagination/pagination'
import { ListUsersQuery } from './list-users.query'

/** Admins y empleados de la inmobiliaria, paginados. */
@QueryHandler(ListUsersQuery)
export class ListUsersHandler implements IQueryHandler<
  ListUsersQuery,
  PaginatedResult<PublicUser>
> {
  constructor(private readonly users: UserRepository) {}

  execute(query: ListUsersQuery): Promise<PaginatedResult<PublicUser>> {
    return paginateWith(query.page, async (page) => {
      const [users, total] = await this.users.listInternal(query.filter, page)
      return [users.map(toPublicUser), total]
    })
  }
}
