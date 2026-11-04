import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { Role } from '@/modules/auth/domain/enums/role.enum'
import { AnyRole } from '../decorators/any-role.decorator'
import { IsPublic } from '../decorators/is-public.decorator'
import { Roles } from '../decorators/roles.decorator'
import { RolesGuard } from './roles.guard'

class SampleController {
  withoutDecorator() {}
  @Roles(Role.ADMIN)
  adminOnly() {}
  @AnyRole()
  anyone() {}
  @IsPublic()
  open() {}
}

function contextFor(handlerName: keyof SampleController, role?: Role) {
  return {
    getType: () => 'http',
    getHandler: () => SampleController.prototype[handlerName],
    getClass: () => SampleController,
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { role } : undefined }),
    }),
  } as unknown as ExecutionContext
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector())

  // Antes un handler sin decorador dejaba pasar a cualquier rol, incluidos
  // OWNER y RENTER, que comparten tenant con el personal.
  it.each([Role.OWNER, Role.RENTER])(
    'rechaza a %s en un endpoint sin decorador de roles',
    (role) => {
      expect(() =>
        guard.canActivate(contextFor('withoutDecorator', role)),
      ).toThrow()
    },
  )

  it.each([Role.ADMIN, Role.EMPLOYEE])(
    'deja pasar a %s en un endpoint sin decorador de roles',
    (role) => {
      expect(guard.canActivate(contextFor('withoutDecorator', role))).toBe(true)
    },
  )

  it('deja pasar a un rol de portal si el endpoint es @AnyRole', () => {
    expect(guard.canActivate(contextFor('anyone', Role.OWNER))).toBe(true)
  })

  it('deja pasar a un rol de portal con token en un endpoint @IsPublic', () => {
    expect(guard.canActivate(contextFor('open', Role.RENTER))).toBe(true)
  })

  it('sigue exigiendo el rol declarado con @Roles', () => {
    expect(() =>
      guard.canActivate(contextFor('adminOnly', Role.EMPLOYEE)),
    ).toThrow()
    expect(guard.canActivate(contextFor('adminOnly', Role.ADMIN))).toBe(true)
  })
})
