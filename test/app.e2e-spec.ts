import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { PrismaService } from '../src/infrastructure/prisma/prisma.service'
import { UserRepository } from '../src/domain/auth/repositories/user.repository'
import { RefreshTokenRepository } from '../src/domain/auth/repositories/refresh-token.repository'
import { ErrorCode } from '../src/shared/errors/error-codes'

/**
 * e2e sin base de datos: mockeamos Prisma y los repositorios.
 *
 * Lo que se prueba acá es el cableado —grafo de inyección, guards globales,
 * pipes y filtros— y el **contrato de las respuestas de error**, que es lo que
 * consume el frontend y lo que más fácil se rompe sin que nadie se entere.
 */
describe('App (e2e)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn(),
        $disconnect: jest.fn(),
        $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
      })
      .overrideProvider(UserRepository)
      .useValue({
        findById: jest.fn().mockResolvedValue(null),
        findByEmail: jest.fn().mockResolvedValue(null),
        existsByEmail: jest.fn().mockResolvedValue(false),
        create: jest.fn(),
        changePassword: jest.fn(),
        rehashPassword: jest.fn(),
        registerFailedLogin: jest.fn(),
        registerSuccessfulLogin: jest.fn(),
      })
      .overrideProvider(RefreshTokenRepository)
      .useValue({
        create: jest.fn(),
        findByTokenHash: jest.fn().mockResolvedValue(null),
        rotate: jest.fn(),
        revokeById: jest.fn(),
        revokeFamily: jest.fn().mockResolvedValue(0),
        revokeAllForUser: jest.fn().mockResolvedValue(0),
        deleteExpired: jest.fn().mockResolvedValue(0),
      })
      .compile()

    app = moduleFixture.createNestApplication<NestExpressApplication>()
    configureApp(app as NestExpressApplication)
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
  })

  describe('endpoints públicos', () => {
    it('GET / responde sin token', async () => {
      const response = await request(app.getHttpServer()).get('/').expect(200)

      expect(response.body).toEqual({ message: 'API is running' })
    })

    it('GET /health responde sin token', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200)

      expect(response.body.status).toBe('ok')
    })

    it('toda respuesta trae x-correlation-id', async () => {
      const response = await request(app.getHttpServer()).get('/').expect(200)

      expect(response.headers['x-correlation-id']).toBeTruthy()
    })

    it('respeta el x-correlation-id que manda el cliente', async () => {
      const response = await request(app.getHttpServer())
        .get('/')
        .set('x-correlation-id', 'mi-trace-123')
        .expect(200)

      expect(response.headers['x-correlation-id']).toBe('mi-trace-123')
    })
  })

  describe('autenticación cerrada por defecto', () => {
    it('GET /api/v1/auth/me sin token devuelve 401 con el formato estándar', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .expect(401)

      expect(response.body).toMatchObject({
        success: false,
        code: ErrorCode.TOKEN_MISSING,
        errors: [],
      })
      expect(response.body.correlationId).toBeTruthy()
      expect(response.body.timestamp).toBeTruthy()
      expect(response.body.path).toBe('/api/v1/auth/me')
    })

    it('un token basura devuelve TOKEN_INVALID, no un 500', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer no-es-un-jwt')
        .expect(401)

      expect(response.body.code).toBe(ErrorCode.TOKEN_INVALID)
    })

    it('GET /health/metrics exige autenticación', async () => {
      await request(app.getHttpServer()).get('/health/metrics').expect(401)
    })
  })

  describe('errores de validación', () => {
    it('devuelve un detalle por campo', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'no-es-un-email', password: '' })
        .expect(400)

      expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED)
      expect(response.body.errors.length).toBeGreaterThanOrEqual(2)

      const fields = response.body.errors.map((e: any) => e.field)
      expect(fields).toContain('email')
      expect(fields).toContain('password')
      expect(response.body.errors[0]).toHaveProperty('code')
    })

    it('rechaza propiedades que no están en el DTO', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'ana@ejemplo.com',
          password: 'ClaveValida123',
          isAdmin: true,
        })
        .expect(400)

      expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED)
    })

    it('nunca devuelve la contraseña enviada en el cuerpo del error', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'no-es-un-email', password: 'ClaveSecreta123' })
        .expect(400)

      expect(JSON.stringify(response.body)).not.toContain('ClaveSecreta123')
    })
  })

  describe('login', () => {
    it('con un email inexistente devuelve 401 INVALID_CREDENTIALS', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nadie@ejemplo.com', password: 'ClaveValida123' })
        .expect(401)

      expect(response.body.code).toBe(ErrorCode.INVALID_CREDENTIALS)
      // El mensaje no debe revelar si el email existe.
      expect(response.body.message).not.toMatch(/no existe|not found|usuario/i)
    })
  })

  describe('rutas inexistentes', () => {
    it('un 404 sale con el mismo formato de error', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/no-existe')
        .expect(404)

      expect(response.body).toMatchObject({ success: false })
      expect(response.body.correlationId).toBeTruthy()
    })
  })
})
