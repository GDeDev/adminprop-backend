import { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { randomUUID } from 'node:crypto'
import request from 'supertest'

import { Configuration } from '../src/shared/config/configuration'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp } from './utils/app'
import {
  createTenant,
  createUser,
  resetDatabase,
  TEST_PASSWORD,
} from './utils/database'

/**
 * Criterios de aceptación y casos borde de la sesión (spec Fase 4, 7 y 8).
 */
describe('Sesión (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenant: { id: string }
  let user: { id: string }

  beforeAll(async () => {
    await prisma.$connect()
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await resetDatabase(prisma)
    tenant = await createTenant(prisma, 'tenant-a')
    user = await createUser(prisma, { tenantId: tenant.id, email: 'a@a.com' })
  })

  const http = () => request(app.getHttpServer())

  const login = (email = 'a@a.com', password = TEST_PASSWORD) =>
    http().post('/api/v1/auth/login').send({ email, password })

  const me = (token: string) =>
    http().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`)

  /** Firma un access token con el secreto real: sólo cambia lo que se pide. */
  function signAccessToken(
    claims: Record<string, unknown>,
    expiresIn: number,
  ): string {
    const jwt = app
      .get<ConfigService<Configuration, true>>(ConfigService)
      .get('jwt', { infer: true })
    return new JwtService().sign(
      {
        sub: user.id,
        email: 'a@a.com',
        role: 'EMPLOYEE',
        userType: 'internal',
        tenantId: tenant.id,
        typ: 'access',
        ...claims,
      },
      {
        secret: jwt.accessSecret,
        expiresIn,
        issuer: jwt.issuer,
        audience: jwt.audience,
      },
    )
  }

  it('login válido devuelve tokens y los datos del usuario', async () => {
    const response = await login().expect(200)

    expect(response.body.data.tokens).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
    })
    expect(response.body.data.user).toMatchObject({
      id: user.id,
      role: 'EMPLOYEE',
      tenantId: tenant.id,
    })
    expect(response.body.data.user).not.toHaveProperty('passwordHash')
  })

  it('credenciales inválidas: 401 con mensaje genérico', async () => {
    const badPassword = await login('a@a.com', 'Incorrecta123').expect(401)
    const unknownEmail = await login('nadie@a.com').expect(401)

    expect(badPassword.body.code).toBe('INVALID_CREDENTIALS')
    expect(unknownEmail.body.message).toBe(badPassword.body.message)
  })

  it('un usuario desactivado recibe el mismo 401 que una contraseña incorrecta', async () => {
    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
    })

    const response = await login().expect(401)

    expect(response.body.code).toBe('INVALID_CREDENTIALS')
  })

  it('un endpoint protegido sin token responde 401', async () => {
    const response = await http().get('/api/v1/auth/me').expect(401)

    expect(response.body.code).toBe('TOKEN_MISSING')
  })

  it('un token vencido responde 401 TOKEN_EXPIRED', async () => {
    const expired = signAccessToken({}, -60)

    const response = await me(expired).expect(401)

    expect(response.body.code).toBe('TOKEN_EXPIRED')
  })

  it('un token con la firma manipulada responde 401', async () => {
    const { body } = await login().expect(200)
    const [header, payload] = body.data.tokens.accessToken.split('.')
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, 'base64url').toString()),
        role: 'ADMIN',
      }),
    ).toString('base64url')

    const response = await me(`${header}.${forged}.firma-falsa`).expect(401)

    expect(response.body.code).toBe('TOKEN_INVALID')
  })

  it('un token de una inmobiliaria que ya no existe responde 401', async () => {
    const orphan = signAccessToken(
      { sub: randomUUID(), tenantId: randomUUID() },
      300,
    )

    const response = await me(orphan).expect(401)

    expect(response.body.code).toBe('SESSION_REVOKED')
  })

  it('desactivar a un usuario corta su sesión en el request siguiente', async () => {
    const { body } = await login().expect(200)
    const token = body.data.tokens.accessToken
    await me(token).expect(200)

    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
    })

    const response = await me(token).expect(401)
    expect(response.body.code).toBe('SESSION_REVOKED')
  })

  it('deshabilitar la inmobiliaria corta la sesión de sus usuarios', async () => {
    const { body } = await login().expect(200)

    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { isActive: false },
    })

    await me(body.data.tokens.accessToken).expect(401)
  })

  it('un refresh token válido genera un access token nuevo', async () => {
    const { body } = await login().expect(200)

    const refreshed = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: body.data.tokens.refreshToken })
      .expect(200)

    await me(refreshed.body.data.accessToken).expect(200)
  })

  it('después del logout el refresh token queda revocado', async () => {
    const { body } = await login().expect(200)
    const { refreshToken } = body.data.tokens

    await http().post('/api/v1/auth/logout').send({ refreshToken }).expect(204)

    const response = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401)
    expect(response.body.code).toMatch(/^REFRESH_TOKEN_/)
  })

  describe('rate limiting', () => {
    let throttled: INestApplication
    const original = process.env.THROTTLE_ENABLED

    beforeAll(async () => {
      // El resto de los e2e corre sin throttle (test/setup.ts); acá se prende
      // con los valores por defecto de la spec: 5 intentos por minuto.
      process.env.THROTTLE_ENABLED = 'true'
      throttled = await createTestApp()
    })

    afterAll(async () => {
      await throttled.close()
      process.env.THROTTLE_ENABLED = original
    })

    it('bloquea el 6to intento de login fallido en el mismo minuto', async () => {
      const attempt = () =>
        request(throttled.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: 'nadie@a.com', password: 'Incorrecta123' })

      for (let i = 0; i < 5; i++) await attempt().expect(401)

      const sixth = await attempt().expect(429)
      expect(sixth.body.code).toBe('RATE_LIMIT_EXCEEDED')
      expect(sixth.headers['retry-after']).toBeDefined()
    })
  })
})
