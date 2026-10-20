import { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'

/** Marca de la inmobiliaria: la sesión y el login de portal (Fase 4). */
describe('Tenants (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string }

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
    tenantA = await createTenant(prisma, 'tenant-a')
    await prisma.tenant.update({
      where: { id: tenantA.id },
      data: { primaryColor: '#1f4e79' },
    })
    const tenantB = await createTenant(prisma, 'tenant-b')
    await createUser(prisma, { tenantId: tenantA.id, email: 'a@a.com' })
    await createUser(prisma, { tenantId: tenantB.id, email: 'b@b.com' })
  })

  describe('GET /tenants/current', () => {
    it('devuelve la inmobiliaria del usuario logueado', async () => {
      const token = await loginAs(app, 'a@a.com')

      const response = await request(app.getHttpServer())
        .get('/api/v1/tenants/current')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(response.body.data).toEqual({
        id: tenantA.id,
        name: 'Inmobiliaria tenant-a',
        slug: 'tenant-a',
        logoUrl: null,
        primaryColor: '#1f4e79',
      })
    })

    it('sin sesión responde 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/tenants/current')
        .expect(401)
    })
  })

  describe('GET /tenants/by-slug/:slug', () => {
    it('es público y devuelve la marca', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/tenants/by-slug/TENANT-A')
        .expect(200)

      expect(response.body.data).toMatchObject({
        slug: 'tenant-a',
        primaryColor: '#1f4e79',
      })
    })

    it('una inmobiliaria deshabilitada responde 404, igual que una inexistente', async () => {
      await prisma.tenant.update({
        where: { id: tenantA.id },
        data: { isActive: false },
      })

      const disabled = await request(app.getHttpServer())
        .get('/api/v1/tenants/by-slug/tenant-a')
        .expect(404)
      const missing = await request(app.getHttpServer())
        .get('/api/v1/tenants/by-slug/no-existe')
        .expect(404)

      expect(disabled.body.code).toBe('TENANT_NOT_FOUND')
      expect(missing.body.message).toBe(disabled.body.message)
    })
  })
})
