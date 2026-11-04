import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { Role } from '@/modules/auth/domain/enums/role.enum'
import { AnyRole } from '../decorators/any-role.decorator'
import { IsPublic } from '../decorators/is-public.decorator'
import { Roles } from '../decorators/roles.decorator'
import { RolesGuard } from './roles.guard'

function contextFor(
  controller: new () => object,
  handler: string,
  role?: Role,
): ExecutionContext {
  const proto = controller.prototype as Record<string, () => void>
  return {
    getType: () => 'http',
    getHandler: () => proto[handler],
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { role } : undefined }),
    }),
  } as unknown as ExecutionContext
}

class Sample {
  undeclared() {}

  @Roles(Role.ADMIN)
  adminOnly() {}

  @AnyRole()
  anyRole() {}

  @IsPublic()
  open() {}
}

describe('RolesGuard (default-deny)', () => {
  const guard = new RolesGuard(new Reflector())

  // Antes un handler sin metadata dejaba pasar a cualquier autenticado,
  // incluidos propietarios e inquilinos (A-3).
  it.each([Role.ADMIN, Role.EMPLOYEE, Role.OWNER, Role.RENTER])(
    'rechaza con 403 a %s un handler sin @Roles ni @AnyRole',
    (role) => {
      expect(() =>
        guard.canActivate(contextFor(Sample, 'undeclared', role)),
      ).toThrow()
    },
  )

  it('deja pasar a cualquier rol un handler con @AnyRole', () => {
    for (const role of [Role.ADMIN, Role.OWNER, Role.RENTER]) {
      expect(guard.canActivate(contextFor(Sample, 'anyRole', role))).toBe(true)
    }
  })

  it('deja pasar un handler @IsPublic aunque no haya usuario', () => {
    expect(guard.canActivate(contextFor(Sample, 'open'))).toBe(true)
  })

  it('respeta @Roles: pasa el rol listado y rechaza el resto', () => {
    expect(guard.canActivate(contextFor(Sample, 'adminOnly', Role.ADMIN))).toBe(
      true,
    )
    expect(() =>
      guard.canActivate(contextFor(Sample, 'adminOnly', Role.OWNER)),
    ).toThrow()
  })
})
