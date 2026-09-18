import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Request } from 'express'

import { Role } from '@/domain/auth/enums/role.enum'
import { AuthErrors } from '@/domain/auth/exceptions/auth.exceptions'
import { ROLES_KEY } from '../decorators/roles.decorator'

/**
 * Guard de autorización por rol. Corre después del `JwtAuthGuard`, así que
 * puede asumir que `request.user` ya está cargado.
 *
 * Sin `@Roles(...)` en el handler ni en el controller, deja pasar: la
 * autorización es opt-in, a diferencia de la autenticación.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true

    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (!requiredRoles?.length) return true

    const request = context.switchToHttp().getRequest<Request>()
    const user = request.user

    // Un endpoint con @Roles() pero sin @IsPublic() siempre tiene usuario. Si
    // falta, alguien combinó @IsPublic() con @Roles(): no tiene sentido.
    if (!user) throw AuthErrors.tokenMissing()

    if (!requiredRoles.includes(user.role)) {
      throw AuthErrors.insufficientPermissions(requiredRoles)
    }

    return true
  }
}
