import { Test, TestingModule } from '@nestjs/testing'

import { RefreshToken } from '@/modules/auth/domain/entities/refresh-token.entity'
import { User } from '@/modules/auth/domain/entities/user.entity'
import { Role } from '@/modules/auth/domain/enums/role.enum'
import { RefreshTokenRepository } from '@/modules/auth/domain/repositories/refresh-token.repository'
import { UserRepository } from '@/modules/auth/domain/repositories/user.repository'
import { RefreshTokenAlreadyRotatedError } from '@/modules/auth/infrastructure/repositories/refresh-token.repository.impl'
import { AuthTokenIssuer } from '@/modules/auth/infrastructure/services/auth-token-issuer.service'
import { TokenService } from '@/modules/auth/infrastructure/services/token.service'
import { ErrorCode } from '@/shared/errors/error-codes'
import { AuthTokens } from '../../results/auth-result'
import { RefreshTokenCommand } from './refresh-token.command'
import { RefreshTokenHandler } from './refresh-token.handler'

const TOKENS: AuthTokens = {
  accessToken: 'access-nuevo',
  refreshToken: 'refresh-nuevo',
  tokenType: 'Bearer',
  expiresIn: 900,
}

const USER: User = {
  id: 'user-1',
  tenantId: 'tenant-1',
  tenantIsActive: true,
  email: 'ana@ejemplo.com',
  passwordHash: '$2a$10$hash',
  firstName: null,
  lastName: null,
  role: Role.EMPLOYEE,
  isActive: true,
  failedLoginAttempts: 0,
  lockedUntil: null,
  lastLoginAt: null,
  passwordChangedAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

function storedToken(overrides: Partial<RefreshToken> = {}): RefreshToken {
  return {
    id: 'token-1',
    tokenHash: 'hash-1',
    userId: 'user-1',
    familyId: 'family-1',
    expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null,
    replacedById: null,
    userAgent: null,
    ip: null,
    createdAt: new Date(),
    ...overrides,
  }
}

describe('RefreshTokenHandler', () => {
  let handler: RefreshTokenHandler
  let tokenService: jest.Mocked<TokenService>
  let refreshTokenRepository: jest.Mocked<RefreshTokenRepository>
  let userRepository: jest.Mocked<UserRepository>
  let tokenIssuer: jest.Mocked<AuthTokenIssuer>

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenHandler,
        {
          provide: TokenService,
          useValue: {
            verifyRefreshToken: jest.fn().mockResolvedValue({
              sub: 'user-1',
              jti: 'jti-1',
              fid: 'family-1',
            }),
            hashToken: jest.fn().mockReturnValue('hash-1'),
          },
        },
        {
          provide: RefreshTokenRepository,
          useValue: {
            findByTokenHash: jest.fn(),
            revokeFamily: jest.fn().mockResolvedValue(3),
            revokeAllForUser: jest.fn().mockResolvedValue(2),
          },
        },
        {
          provide: UserRepository,
          useValue: { findByIdForSession: jest.fn().mockResolvedValue(USER) },
        },
        {
          provide: AuthTokenIssuer,
          useValue: { rotateSession: jest.fn().mockResolvedValue(TOKENS) },
        },
      ],
    }).compile()

    handler = module.get(RefreshTokenHandler)
    tokenService = module.get(TokenService)
    refreshTokenRepository = module.get(RefreshTokenRepository)
    userRepository = module.get(UserRepository)
    tokenIssuer = module.get(AuthTokenIssuer)
  })

  it('rota el token y devuelve un par nuevo', async () => {
    refreshTokenRepository.findByTokenHash.mockResolvedValue(storedToken())

    const result = await handler.execute(new RefreshTokenCommand('el-token'))

    expect(result).toEqual(TOKENS)
    expect(tokenIssuer.rotateSession).toHaveBeenCalledWith(
      USER,
      'token-1',
      'family-1',
      {},
    )
  })

  it('valida la firma antes de tocar la base', async () => {
    tokenService.verifyRefreshToken.mockRejectedValue(
      new Error('firma inválida'),
    )

    await expect(
      handler.execute(new RefreshTokenCommand('token-falsificado')),
    ).rejects.toThrow()

    expect(refreshTokenRepository.findByTokenHash).not.toHaveBeenCalled()
  })

  it('al detectar reuso revoca toda la familia', async () => {
    refreshTokenRepository.findByTokenHash.mockResolvedValue(
      storedToken({ revokedAt: new Date(Date.now() - 1000) }),
    )

    const error = await handler
      .execute(new RefreshTokenCommand('token-ya-rotado'))
      .catch((e) => e)

    expect(error.code).toBe(ErrorCode.REFRESH_TOKEN_REUSED)
    expect(refreshTokenRepository.revokeFamily).toHaveBeenCalledWith('family-1')
    expect(tokenIssuer.rotateSession).not.toHaveBeenCalled()
  })

  it('rechaza un token vencido sin revocar la familia', async () => {
    refreshTokenRepository.findByTokenHash.mockResolvedValue(
      storedToken({ expiresAt: new Date(Date.now() - 1000) }),
    )

    const error = await handler
      .execute(new RefreshTokenCommand('token-vencido'))
      .catch((e) => e)

    expect(error.code).toBe(ErrorCode.REFRESH_TOKEN_EXPIRED)
    // Que un token venza es normal, no es señal de robo.
    expect(refreshTokenRepository.revokeFamily).not.toHaveBeenCalled()
  })

  it('rechaza un token con firma válida que no está en la base', async () => {
    refreshTokenRepository.findByTokenHash.mockResolvedValue(null)

    const error = await handler
      .execute(new RefreshTokenCommand('token-huerfano'))
      .catch((e) => e)

    expect(error.code).toBe(ErrorCode.REFRESH_TOKEN_INVALID)
    expect(refreshTokenRepository.revokeFamily).not.toHaveBeenCalled()
  })

  it('corta las sesiones si el usuario quedó inactivo', async () => {
    refreshTokenRepository.findByTokenHash.mockResolvedValue(storedToken())
    userRepository.findByIdForSession.mockResolvedValue({
      ...USER,
      isActive: false,
    })

    const error = await handler
      .execute(new RefreshTokenCommand('el-token'))
      .catch((e) => e)

    expect(error.code).toBe(ErrorCode.ACCOUNT_INACTIVE)
    expect(refreshTokenRepository.revokeAllForUser).toHaveBeenCalledWith(
      'user-1',
    )
  })

  it('revoca las sesiones si la inmobiliaria se deshabilitó', async () => {
    refreshTokenRepository.findByTokenHash.mockResolvedValue(storedToken())
    userRepository.findByIdForSession.mockResolvedValue({
      ...USER,
      tenantIsActive: false,
    })

    const error = await handler
      .execute(new RefreshTokenCommand('el-token'))
      .catch((e) => e)

    expect(error.code).toBe(ErrorCode.ACCOUNT_INACTIVE)
    expect(refreshTokenRepository.revokeAllForUser).toHaveBeenCalledWith(
      'user-1',
    )
  })

  it('ante una rotación concurrente devuelve token inválido, no reuso', async () => {
    refreshTokenRepository.findByTokenHash.mockResolvedValue(storedToken())
    tokenIssuer.rotateSession.mockRejectedValue(
      new RefreshTokenAlreadyRotatedError('token-1'),
    )

    const error = await handler
      .execute(new RefreshTokenCommand('el-token'))
      .catch((e) => e)

    // Dos pestañas refrescando a la vez no es un ataque: no tiramos abajo la
    // familia, el cliente reintenta con el token nuevo.
    expect(error.code).toBe(ErrorCode.REFRESH_TOKEN_INVALID)
    expect(refreshTokenRepository.revokeFamily).not.toHaveBeenCalled()
  })
})
