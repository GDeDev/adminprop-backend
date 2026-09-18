import { SetMetadata } from '@nestjs/common'

import { Role } from '@/domain/auth/enums/role.enum'

export const ROLES_KEY = 'roles'

/**
 * Restringe un endpoint a ciertos roles. Alcanza con tener **uno** de los
 * listados.
 *
 * ```ts
 * @Roles(Role.ADMIN)
 * @Delete(':id')
 * remove() { ... }
 * ```
 *
 * Lo aplica el `RolesGuard`, que corre después del `JwtAuthGuard`.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles)
