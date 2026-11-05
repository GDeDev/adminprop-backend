import { INestApplication } from '@nestjs/common'
import { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { PrismaService } from '../src/shared/prisma/prisma.service'

const ALLOWED = 'https://backoffice.example.com'
const FOREIGN = 'https://evil.example.org'

/**
 * Preflight de CORS. El navegador pide permiso antes de mandar un header que
 * no es "simple": `Idempotency-Key` al registrar un pago. Si la API no lo lista
 * en `allowedHeaders`, el POST nunca sale y el usuario ve un error de red.
 */
describe('CORS (e2e)', () => {
  let app: INestApplication
  const previous = process.env.CORS_ORIGINS

  beforeAll(async () => {
    process.env.CORS_ORIGINS = ALLOWED
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn(),
        $disconnect: jest.fn(),
        $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
      })
      .compile()
    app = moduleRef.createNestApplication<NestExpressApplication>()
    configureApp(app as NestExpressApplication)
    await app.init()
  })

  afterAll(async () => {
    if (previous === undefined) delete process.env.CORS_ORIGINS
    else process.env.CORS_ORIGINS = previous
    await app.close()
  })

  const preflight = (origin: string, headers: string) =>
    request(app.getHttpServer())
      .options('/api/v1/installments/1/payments')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', headers)

  it('permite Idempotency-Key en el preflight desde un origen permitido', async () => {
    const response = await preflight(ALLOWED, 'idempotency-key,authorization')
    expect(response.status).toBeLessThan(300)
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED)
    const allowed = String(
      response.headers['access-control-allow-headers'],
    ).toLowerCase()
    expect(allowed).toContain('idempotency-key')
    expect(allowed).toContain('authorization')
  })

  it('sigue cerrado para un origen no permitido', async () => {
    const response = await preflight(FOREIGN, 'idempotency-key')
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })
})
