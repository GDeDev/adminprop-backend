import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Request } from 'express'

import { Role } from '@/modules/auth/domain/enums/role.enum'
import { AuthErrors } from '@/modules/auth/domain/exceptions/auth.exceptions'
import { ANY_ROLE_KEY } from '../decorators/any-role.decorator'
import { IS_PUBLIC_KEY } from '../decorators/is-public.decorator'
import { ROLES_KEY } from '../decorators/roles.decorator'

/**
 * Guard de autorización por rol. Corre después del `JwtAuthGuard`, así que
 * puede asumir que `request.user` ya está cargado.
 *
 * Cierra por defecto (D-195): un handler autenticado debe declarar
 * `@Roles(...)` o `@AnyRole()` (en el handler o en el controller); si no, 403
 * para todos. Antes dejaba pasar, y un controller nuevo sin `@Roles` quedaba
 * abierto a propietarios e inquilinos, que comparten tenant con la inmobiliaria.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true

    const targets = [context.getHandler(), context.getClass()]

    // Las rutas públicas no tienen usuario: el JwtAuthGuard ya las dejó pasar.
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true
    }

    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(
      ROLES_KEY,
      targets,
    )

    if (!requiredRoles?.length) {
      if (this.reflector.getAllAndOverride<boolean>(ANY_ROLE_KEY, targets)) {
        return true
      }
      throw AuthErrors.insufficientPermissions([])
    }

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
