import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'

import { Configuration, JwtConfig } from '@/shared/config/configuration'
import { ErrorCode } from '@/shared/errors'
import { TOKEN_TYPE_ACCESS } from '../types/jwt-payload.type'
import { TokenService } from './token.service'

const jwtConfig = {
  accessSecret: 'secreto-de-acceso-de-prueba-de-32-caracteres',
  accessTtl: '15m',
  refreshSecret: 'secreto-de-refresh-de-prueba-de-32-caracteres',
  refreshTtl: '7d',
  issuer: 'adminprop-test',
  audience: 'adminprop-test',
} as unknown as JwtConfig

describe('TokenService: algoritmo fijo (H14)', () => {
  const jwt = new JwtService()
  const service = new TokenService(jwt, {
    get: () => jwtConfig,
  } as unknown as ConfigService<Configuration, true>)

  const payload = {
    sub: 'user-1',
    email: 'ana@ejemplo.com',
    role: 'ADMIN',
    userType: 'STAFF',
    tenantId: 'ten-1',
    typ: TOKEN_TYPE_ACCESS,
  }

  it('firma con HS256', async () => {
    const token = (await service.signAccessToken(payload as never)).token
    const header = JSON.parse(
      Buffer.from(token.split('.')[0], 'base64url').toString(),
    ) as { alg: string }
    expect(header.alg).toBe('HS256')
  })

  // Antes la verificación no fijaba `algorithms`: aceptaba cualquier HS* firmado
  // con el secreto. Fijarlo cierra la puerta a confusiones de algoritmo.
  it('rechaza un token firmado con otro algoritmo, aun con el secreto correcto', async () => {
    const token = await jwt.signAsync(payload, {
      secret: jwtConfig.accessSecret,
      algorithm: 'HS512',
      expiresIn: '5m',
      issuer: jwtConfig.issuer,
      audience: jwtConfig.audience,
    })
    await expect(service.verifyAccessToken(token)).rejects.toMatchObject({
      code: ErrorCode.TOKEN_INVALID,
    })
  })
})
