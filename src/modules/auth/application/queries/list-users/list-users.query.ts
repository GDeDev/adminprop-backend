import { InternalUserFilter } from '@/modules/auth/domain/repositories/user.repository'
import { PaginationQueryDto } from '@/shared/pagination'

export class ListUsersQuery {
  constructor(
    public readonly filter: InternalUserFilter,
    public readonly page: Partial<PaginationQueryDto>,
  ) {}
}
