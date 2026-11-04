import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Request } from 'express'

import { isInternalRole, Role } from '@/modules/auth/domain/enums/role.enum'
import { AuthErrors } from '@/modules/auth/domain/exceptions/auth.exceptions'
import { ANY_ROLE_KEY } from '../decorators/any-role.decorator'
import { IS_PUBLIC_KEY } from '../decorators/is-public.decorator'
import { ROLES_KEY } from '../decorators/roles.decorator'

/**
 * Guard de autorización por rol. Corre después del `JwtAuthGuard`, así que
 * puede asumir que `request.user` ya está cargado.
 *
 * Sin `@Roles(...)` ni `@AnyRole()` ni `@IsPublic()`, el endpoint queda para el
 * personal (ADMIN/EMPLOYEE) y se rechaza a los roles de portal. Es la misma
 * lógica que el guard de autenticación: un endpoint nuevo nace cerrado, así
 * que olvidarse el decorador no lo abre a propietarios ni inquilinos.
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

    const request = context.switchToHttp().getRequest<Request>()
    const user = request.user

    if (!requiredRoles?.length) {
      const targets = [context.getHandler(), context.getClass()]
      const isOpen =
        this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ||
        this.reflector.getAllAndOverride<boolean>(ANY_ROLE_KEY, targets)
      if (isOpen || !user || isInternalRole(user.role)) return true
      throw AuthErrors.insufficientPermissions([Role.ADMIN, Role.EMPLOYEE])
    }

    // Un endpoint con @Roles() pero sin @IsPublic() siempre tiene usuario. Si
    // falta, alguien combinó @IsPublic() con @Roles(): no tiene sentido.
    if (!user) throw AuthErrors.tokenMissing()

    if (!requiredRoles.includes(user.role)) {
      throw AuthErrors.insufficientPermissions(requiredRoles)
    }

    return true
  }
}
