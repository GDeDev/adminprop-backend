import { INestApplication } from '@nestjs/common'
import { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import {
  TenantContextMissingError,
  TenantMismatchError,
} from '../src/infrastructure/prisma/extensions/tenant.extension'
import { PrismaService } from '../src/infrastructure/prisma/prisma.service'
import { RequestContext } from '../src/shared/context/request-context'
import {
  createTenant,
  createUser,
  resetDatabase,
  TEST_PASSWORD,
} from './utils/database'

/**
 * Aislamiento entre inmobiliarias contra Postgres real (spec Fase 1, 3.2).
 *
 * Contra la base y no con mocks porque lo que se prueba es justamente lo que
 * hace Prisma con los `where` que arma la extensión, y cómo se combina con el
 * soft delete y la auditoría.
 */
describe('Multi-tenant (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let tenantA: { id: string }
  let tenantB: { id: string }
  let userA: { id: string }
  let userB: { id: string }

  const inTenant = <T>(tenantId: string, fn: () => Promise<T>) =>
    RequestContext.run({ correlationId: 'test' }, () =>
      RequestContext.runInTenant(tenantId, fn),
    )

  beforeAll(async () => {
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await resetDatabase(prisma)
    tenantA = await createTenant(prisma, 'tenant-a')
    tenantB = await createTenant(prisma, 'tenant-b')
    userA = await createUser(prisma, { tenantId: tenantA.id, email: 'a@a.com' })
    userB = await createUser(prisma, { tenantId: tenantB.id, email: 'b@b.com' })
  })

  describe('filtro de tenant de Prisma', () => {
    it('un tenant sólo ve sus propios registros', async () => {
      const users = await inTenant(tenantA.id, () => prisma.db.user.findMany())

      expect(users.map((u) => u.id)).toEqual([userA.id])
    })

    it('buscar por id un registro de otro tenant devuelve null, como si no existiera', async () => {
      // De acá sale el 404 (y no un 403) del caso borde de la spec: no se
      // revela que el registro existe.
      const found = await inTenant(tenantA.id, () =>
        prisma.db.user.findUnique({ where: { id: userB.id } }),
      )

      expect(found).toBeNull()
    })

    it('no deja actualizar un registro de otro tenant', async () => {
      const error = await inTenant(tenantA.id, () =>
        prisma.db.user.update({
          where: { id: userB.id },
          data: { firstName: 'Hackeado' },
        }),
      ).catch((e) => e)

      // P2025 → PrismaExceptionFilter lo convierte en 404.
      expect(error.code).toBe('P2025')
      const intact = await prisma.user.findUnique({ where: { id: userB.id } })
      expect(intact?.firstName).toBeNull()
    })

    it('no deja borrar (ni lógicamente) un registro de otro tenant', async () => {
      const error = await inTenant(tenantA.id, () =>
        prisma.db.user.delete({ where: { id: userB.id } }),
      ).catch((e) => e)

      expect(error.code).toBe('P2025')
      const intact = await prisma.user.findUnique({ where: { id: userB.id } })
      expect(intact?.deletedAt).toBeNull()
    })

    it('updateMany y count quedan acotados al tenant', async () => {
      const result = await inTenant(tenantA.id, () =>
        prisma.db.user.updateMany({ data: { firstName: 'Masivo' } }),
      )

      expect(result.count).toBe(1)
      const other = await prisma.user.findUnique({ where: { id: userB.id } })
      expect(other?.firstName).toBeNull()
    })

    it('un alta toma el tenant del contexto', async () => {
      const created = await inTenant(tenantA.id, () =>
        prisma.db.user.create({
          // Sin tenantId a propósito: lo completa la extensión.
          data: {
            email: 'nuevo@a.com',
            passwordHash: 'x',
            role: 'EMPLOYEE',
          } as never,
        }),
      )

      expect(created.tenantId).toBe(tenantA.id)
    })

    it('rechaza un alta que pide explícitamente otro tenant', async () => {
      const error = await inTenant(tenantA.id, () =>
        prisma.db.user.create({
          data: {
            tenantId: tenantB.id,
            email: 'intruso@b.com',
            passwordHash: 'x',
            role: 'EMPLOYEE',
          },
        }),
      ).catch((e) => e)

      expect(error).toBeInstanceOf(TenantMismatchError)
    })

    it('sin tenant en el contexto la consulta falla en vez de traer todo', async () => {
      // Fallar cerrado: un worker o un cron que se olvidó de runInTenant()
      // tiene que romper, no leer los datos de todas las inmobiliarias.
      const error = await RequestContext.run({ correlationId: 'test' }, () =>
        prisma.db.user.findMany(),
      ).catch((e) => e)

      expect(error).toBeInstanceOf(TenantContextMissingError)
    })

    it('prisma.unscoped ve todos los tenants, a propósito', async () => {
      const users = await prisma.unscoped.user.findMany()

      expect(users).toHaveLength(2)
    })

    it('la auditoría registra el tenant del cambio', async () => {
      await inTenant(tenantA.id, () =>
        prisma.db.user.update({
          where: { id: userA.id },
          data: { firstName: 'Ana' },
        }),
      )

      const log = await prisma.auditLog.findFirst({
        where: { entityId: userA.id },
      })
      expect(log).toMatchObject({
        tenantId: tenantA.id,
        entity: 'User',
        action: 'UPDATE',
        changes: { firstName: { before: null, after: 'Ana' } },
      })
    })
  })

  describe('login y JWT', () => {
    let app: INestApplication

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile()

      app = moduleRef.createNestApplication<NestExpressApplication>()
      configureApp(app as NestExpressApplication)
      await app.init()
    })

    afterAll(async () => {
      await app.close()
    })

    const login = (email: string) =>
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: TEST_PASSWORD })

    it('el JWT lleva el tenant del usuario y /auth/me responde dentro de él', async () => {
      const response = await login('a@a.com').expect(200)

      const { accessToken } = response.body.data.tokens
      const payload = JSON.parse(
        Buffer.from(accessToken.split('.')[1], 'base64url').toString(),
      )
      expect(payload.tenantId).toBe(tenantA.id)
      expect(response.body.data.user.tenantId).toBe(tenantA.id)

      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
      expect(me.body.data.id).toBe(userA.id)
    })

    it('el refresh rota la sesión dentro del tenant del usuario', async () => {
      const first = await login('a@a.com').expect(200)

      const refreshed = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.body.data.tokens.refreshToken })
        .expect(200)

      expect(refreshed.body.data.accessToken).toBeTruthy()
    })

    it('con la inmobiliaria deshabilitada nadie puede loguearse', async () => {
      await prisma.tenant.update({
        where: { id: tenantA.id },
        data: { isActive: false },
      })

      const response = await login('a@a.com').expect(403)

      expect(response.body.code).toBe('ACCOUNT_INACTIVE')
    })

    it('ya no existe el registro público', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'x@x.com', password: 'ClaveLarga123' })
        .expect(404)
    })
  })
})
