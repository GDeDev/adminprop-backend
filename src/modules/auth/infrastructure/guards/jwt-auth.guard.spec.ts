import { ExecutionContext } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'

import { Role } from '@/modules/auth/domain/enums/role.enum'
import { UserRepository } from '@/modules/auth/domain/repositories/user.repository'
import { RequestContext } from '@/shared/context/request-context'
import { IsPublic } from '../decorators/is-public.decorator'
import { TokenService } from '../services/token.service'
import { JwtAuthGuard } from './jwt-auth.guard'

class SampleController {
  @IsPublic()
  open() {}
}

const payload = {
  sub: 'user-1',
  email: 'a@b.com',
  role: Role.EMPLOYEE,
  tenantId: 'tenant-1',
  iat: Math.floor(Date.now() / 1000),
}

function build(dbUser: unknown) {
  const tokenService = {
    verifyAccessToken: jest.fn().mockResolvedValue(payload),
  } as unknown as TokenService
  const userRepository = {
    findById: jest.fn().mockResolvedValue(dbUser),
  } as unknown as UserRepository
  const config = {
    get: () => ({ validateUserOnRequest: true }),
  } as unknown as ConfigService<never, true>
  return new JwtAuthGuard(new Reflector(), tokenService, userRepository, config)
}

function publicContext(request: Record<string, unknown>) {
  return {
    getType: () => 'http',
    getHandler: () => SampleController.prototype.open,
    getClass: () => SampleController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
}

describe('JwtAuthGuard en endpoints públicos con token opcional', () => {
  const activeUser = {
    id: 'user-1',
    email: 'a@b.com',
    role: Role.EMPLOYEE,
    isActive: true,
    tenantIsActive: true,
    passwordChangedAt: null,
  }

  async function run(dbUser: unknown) {
    const request: Record<string, unknown> = {
      headers: { authorization: 'Bearer token-valido' },
    }
    let tenantInContext: string | undefined = 'sin-correr'
    await RequestContext.run({ correlationId: 'test' }, async () => {
      await build(dbUser).canActivate(publicContext(request))
      tenantInContext = RequestContext.tenantId
    })
    return { request, tenantInContext }
  }

  it('adjunta al usuario si sigue habilitado', async () => {
    const { request } = await run(activeUser)
    expect(request.user).toMatchObject({ id: 'user-1' })
  })

  // Antes el token de un usuario desactivado seguía identificándolo en rutas
  // públicas hasta que vencía, porque ahí no se consultaba la base.
  it('ignora el token de un usuario desactivado y limpia el contexto', async () => {
    const { request, tenantInContext } = await run({
      ...activeUser,
      isActive: false,
    })
    expect(request.user).toBeUndefined()
    expect(tenantInContext).toBeUndefined()
  })

  it('ignora el token de un usuario que ya no existe', async () => {
    const { request } = await run(null)
    expect(request.user).toBeUndefined()
  })
})
