import { ConfigService } from '@nestjs/config'
import { Test, TestingModule } from '@nestjs/testing'

import { User } from '@/modules/auth/domain/entities/user.entity'
import { Role } from '@/modules/auth/domain/enums/role.enum'
import { UserRepository } from '@/modules/auth/domain/repositories/user.repository'
import { AuthTokenIssuer } from '@/modules/auth/infrastructure/services/auth-token-issuer.service'
import { PasswordService } from '@/modules/auth/infrastructure/services/password.service'
import { RequestContext } from '@/shared/context/request-context'
import { ErrorCode } from '@/shared/errors/error-codes'
import { AuthTokens } from '../../results/auth-result'
import { LoginCommand } from './login.command'
import { LoginHandler } from './login.handler'

const TOKENS: AuthTokens = {
  accessToken: 'access',
  refreshToken: 'refresh',
  tokenType: 'Bearer',
  expiresIn: 900,
}

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    tenantId: 'tenant-1',
    tenantIsActive: true,
    email: 'ana@ejemplo.com',
    passwordHash: '$2a$10$hash',
    firstName: 'Ana',
    lastName: 'Gómez',
    role: Role.EMPLOYEE,
    isActive: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    passwordChangedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }
}

describe('LoginHandler', () => {
  let handler: LoginHandler
  let userRepository: jest.Mocked<UserRepository>
  let passwordService: jest.Mocked<PasswordService>
  let tokenIssuer: jest.Mocked<AuthTokenIssuer>

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoginHandler,
        {
          provide: UserRepository,
          useValue: {
            findByEmail: jest.fn(),
            registerFailedLogin: jest.fn(),
            registerSuccessfulLogin: jest.fn(),
            rehashPassword: jest.fn(),
          },
        },
        {
          provide: PasswordService,
          useValue: {
            compare: jest.fn(),
            burnCompare: jest.fn(),
            hash: jest.fn(),
            needsRehash: jest.fn().mockReturnValue(false),
          },
        },
        {
          provide: AuthTokenIssuer,
          useValue: { issueNewSession: jest.fn().mockResolvedValue(TOKENS) },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue({
              maxFailedAttempts: 5,
              lockDurationMs: 900_000,
            }),
          },
        },
      ],
    }).compile()

    handler = module.get(LoginHandler)
    userRepository = module.get(UserRepository)
    passwordService = module.get(PasswordService)
    tokenIssuer = module.get(AuthTokenIssuer)
  })

  it('devuelve usuario y tokens con credenciales válidas', async () => {
    userRepository.findByEmail.mockResolvedValue(buildUser())
    passwordService.compare.mockResolvedValue(true)

    const result = await handler.execute(
      new LoginCommand('ana@ejemplo.com', 'ClaveCorrecta1'),
    )

    expect(result.tokens).toEqual(TOKENS)
    expect(result.user.email).toBe('ana@ejemplo.com')
    expect(userRepository.registerSuccessfulLogin).toHaveBeenCalledWith(
      'user-1',
    )
  })

  it('no filtra el hash de la contraseña en la respuesta', async () => {
    userRepository.findByEmail.mockResolvedValue(buildUser())
    passwordService.compare.mockResolvedValue(true)

    const result = await handler.execute(
      new LoginCommand('ana@ejemplo.com', 'ClaveCorrecta1'),
    )

    expect(result.user).not.toHaveProperty('passwordHash')
  })

  it('con email inexistente devuelve el mismo error que con contraseña incorrecta', async () => {
    userRepository.findByEmail.mockResolvedValue(null)

    const unknownEmail = await handler
      .execute(new LoginCommand('nadie@ejemplo.com', 'LoQueSea1234'))
      .catch((error) => error)

    userRepository.findByEmail.mockResolvedValue(buildUser())
    passwordService.compare.mockResolvedValue(false)

    const wrongPassword = await handler
      .execute(new LoginCommand('ana@ejemplo.com', 'ClaveIncorrecta1'))
      .catch((error) => error)

    // Mismo código, mismo mensaje y mismo status: no hay forma de distinguir
    // desde afuera si el email existe.
    expect(unknownEmail.code).toBe(ErrorCode.INVALID_CREDENTIALS)
    expect(wrongPassword.code).toBe(ErrorCode.INVALID_CREDENTIALS)
    expect(unknownEmail.message).toBe(wrongPassword.message)
    expect(unknownEmail.getStatus()).toBe(wrongPassword.getStatus())
  })

  it('con email inexistente igual consume tiempo de bcrypt', async () => {
    userRepository.findByEmail.mockResolvedValue(null)

    await expect(
      handler.execute(new LoginCommand('nadie@ejemplo.com', 'LoQueSea1234')),
    ).rejects.toThrow()

    // Sin esto, responder más rápido delataría que el email no existe.
    expect(passwordService.burnCompare).toHaveBeenCalledWith('LoQueSea1234')
  })

  it('cuenta el intento fallido cuando la contraseña es incorrecta', async () => {
    userRepository.findByEmail.mockResolvedValue(buildUser())
    passwordService.compare.mockResolvedValue(false)

    await expect(
      handler.execute(new LoginCommand('ana@ejemplo.com', 'Incorrecta123')),
    ).rejects.toThrow()

    expect(userRepository.registerFailedLogin).toHaveBeenCalledWith(
      'user-1',
      5,
      900_000,
    )
  })

  it('rechaza una cuenta bloqueada sin siquiera validar la contraseña', async () => {
    userRepository.findByEmail.mockResolvedValue(
      buildUser({ lockedUntil: new Date(Date.now() + 60_000) }),
    )

    const error = await handler
      .execute(new LoginCommand('ana@ejemplo.com', 'ClaveCorrecta1'))
      .catch((e) => e)

    expect(error.code).toBe(ErrorCode.ACCOUNT_LOCKED)
    expect(passwordService.compare).not.toHaveBeenCalled()
  })

  it('deja entrar si el bloqueo ya venció', async () => {
    userRepository.findByEmail.mockResolvedValue(
      buildUser({ lockedUntil: new Date(Date.now() - 60_000) }),
    )
    passwordService.compare.mockResolvedValue(true)

    await expect(
      handler.execute(new LoginCommand('ana@ejemplo.com', 'ClaveCorrecta1')),
    ).resolves.toMatchObject({ tokens: TOKENS })
  })

  it('rechaza una cuenta inactiva, pero recién después de validar la contraseña', async () => {
    userRepository.findByEmail.mockResolvedValue(buildUser({ isActive: false }))
    passwordService.compare.mockResolvedValue(true)

    const error = await handler
      .execute(new LoginCommand('ana@ejemplo.com', 'ClaveCorrecta1'))
      .catch((e) => e)

    expect(error.code).toBe(ErrorCode.ACCOUNT_INACTIVE)
    // Si chequeáramos `isActive` antes, sería otra forma de enumerar cuentas.
    expect(passwordService.compare).toHaveBeenCalled()
    expect(tokenIssuer.issueNewSession).not.toHaveBeenCalled()
  })

  it('rechaza el login si la inmobiliaria está deshabilitada', async () => {
    userRepository.findByEmail.mockResolvedValue(
      buildUser({ tenantIsActive: false }),
    )
    passwordService.compare.mockResolvedValue(true)

    const error = await handler
      .execute(new LoginCommand('ana@ejemplo.com', 'ClaveCorrecta1'))
      .catch((e) => e)

    // Mismo error que una cuenta inactiva: no se revela el estado del tenant.
    expect(error.code).toBe(ErrorCode.ACCOUNT_INACTIVE)
    expect(tokenIssuer.issueNewSession).not.toHaveBeenCalled()
  })

  it('después de encontrar al usuario trabaja dentro de su tenant', async () => {
    // Sin esto, los updates del login fallarían contra el filtro de tenant,
    // que no deja tocar un modelo con tenant sin tenant en el contexto.
    userRepository.findByEmail.mockResolvedValue(buildUser())
    passwordService.compare.mockResolvedValue(true)

    let tenantDuringUpdate: string | undefined
    userRepository.registerSuccessfulLogin.mockImplementation(async () => {
      tenantDuringUpdate = RequestContext.tenantId
    })

    await handler.execute(new LoginCommand('ana@ejemplo.com', 'ClaveCorrecta1'))

    expect(tenantDuringUpdate).toBe('tenant-1')
  })

  it('re-hashea la contraseña cuando subió el costo de bcrypt', async () => {
    userRepository.findByEmail.mockResolvedValue(buildUser())
    passwordService.compare.mockResolvedValue(true)
    passwordService.needsRehash.mockReturnValue(true)
    passwordService.hash.mockResolvedValue('$2a$12$hash-nuevo')

    await handler.execute(new LoginCommand('ana@ejemplo.com', 'ClaveCorrecta1'))

    // `rehashPassword` y no `changePassword`: la contraseña no cambió, así que
    // las sesiones abiertas en otros dispositivos no deben caerse.
    expect(userRepository.rehashPassword).toHaveBeenCalledWith(
      'user-1',
      '$2a$12$hash-nuevo',
    )
  })
})
