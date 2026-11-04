import { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginAs } from './utils/app'
import { Role } from '@prisma/client'

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
    await createUser(prisma, {
      tenantId: tenantA.id,
      email: 'admin@a.com',
      role: Role.ADMIN,
    })
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
        whatsapp: null,
        phone: null,
        email: null,
        address: null,
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

  describe('configuración (Fase 15)', () => {
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )

    it('sólo el admin la lee y la edita', async () => {
      const employee = await loginAs(app, 'a@a.com')

      await request(app.getHttpServer())
        .get('/api/v1/tenants/current/settings')
        .set('Authorization', `Bearer ${employee}`)
        .expect(403)
      await request(app.getHttpServer())
        .patch('/api/v1/tenants/current/settings')
        .set('Authorization', `Bearer ${employee}`)
        .send({ taxId: '30-1' })
        .expect(403)
    })

    it('edita los datos legales, normaliza y deja borrar con null', async () => {
      const token = await loginAs(app, 'admin@a.com')

      const updated = await request(app.getHttpServer())
        .patch('/api/v1/tenants/current/settings')
        .set('Authorization', `Bearer ${token}`)
        .send({
          legalName: 'Oppido SRL',
          taxId: '30-12345678-9',
          primaryColor: '#1F4E79',
          whatsapp: '5491122334455',
          bankCbu: '0110599552000000123456',
          phone: '   ',
        })
        .expect(200)

      expect(updated.body.data).toMatchObject({
        legalName: 'Oppido SRL',
        taxId: '30-12345678-9',
        primaryColor: '#1f4e79',
        whatsapp: '5491122334455',
        bankCbu: '0110599552000000123456',
        phone: null,
        receiptSequence: 0,
      })

      const cleared = await request(app.getHttpServer())
        .patch('/api/v1/tenants/current/settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ legalName: null })
        .expect(200)
      expect(cleared.body.data.legalName).toBeNull()
      // Lo que no viene no se toca.
      expect(cleared.body.data.taxId).toBe('30-12345678-9')

      // Los portales ven el contacto sin sesión.
      const branding = await request(app.getHttpServer())
        .get('/api/v1/tenants/by-slug/tenant-a')
        .expect(200)
      expect(branding.body.data.whatsapp).toBe('5491122334455')
    })

    it('el admin edita el punitorio y la gracia por defecto; no se pueden quitar ni salirse de rango (D-227)', async () => {
      const token = await loginAs(app, 'admin@a.com')
      const patch = (body: Record<string, unknown>) =>
        request(app.getHttpServer())
          .patch('/api/v1/tenants/current/settings')
          .set('Authorization', `Bearer ${token}`)
          .send(body)

      const initial = await request(app.getHttpServer())
        .get('/api/v1/tenants/current/settings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      expect(initial.body.data).toMatchObject({
        dailyLateFeePercentage: '5.00',
        paymentGraceDays: 10,
        lateFeeStartDay: 11,
      })

      const updated = await patch({
        dailyLateFeePercentage: '0.5',
        paymentGraceDays: 5,
      }).expect(200)
      expect(updated.body.data).toMatchObject({
        dailyLateFeePercentage: '0.50',
        paymentGraceDays: 5,
        lateFeeStartDay: 6,
      })

      await patch({ dailyLateFeePercentage: '0' }).expect(200)
      for (const body of [
        { dailyLateFeePercentage: null },
        { paymentGraceDays: null },
        { dailyLateFeePercentage: '100.01' },
        { dailyLateFeePercentage: 'cinco' },
        { paymentGraceDays: -1 },
        { paymentGraceDays: 61 },
      ]) {
        await patch(body).expect(400)
      }
      // Lo que no viene no se toca.
      const kept = await patch({ legalName: 'Oppido' }).expect(200)
      expect(kept.body.data.dailyLateFeePercentage).toBe('0.00')
    })

    it('rechaza un color, un CBU o un WhatsApp con formato inválido', async () => {
      const token = await loginAs(app, 'admin@a.com')

      for (const body of [
        { primaryColor: 'azul' },
        { bankCbu: '123' },
        { whatsapp: '+54 9 11 2233' },
        { email: 'no-es-un-email' },
      ]) {
        await request(app.getHttpServer())
          .patch('/api/v1/tenants/current/settings')
          .set('Authorization', `Bearer ${token}`)
          .send(body)
          .expect(400)
      }
    })

    it('sube el logo, lo reemplaza y lo quita', async () => {
      const token = await loginAs(app, 'admin@a.com')

      const first = await request(app.getHttpServer())
        .post('/api/v1/tenants/current/logo')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' })
        .expect(201)
      expect(first.body.data.logoUrl).toContain('logo-')

      const second = await request(app.getHttpServer())
        .post('/api/v1/tenants/current/logo')
        .set('Authorization', `Bearer ${token}`)
        .attach(
          'file',
          Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
          {
            filename: 'logo.svg',
            contentType: 'image/svg+xml',
          },
        )
        .expect(201)
      expect(second.body.data.logoUrl).toMatch(/.svg$/)

      const removed = await request(app.getHttpServer())
        .delete('/api/v1/tenants/current/logo')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      expect(removed.body.data.logoUrl).toBeNull()
    })

    it('rechaza un archivo que no es una imagen aceptada, por más que diga serlo', async () => {
      const token = await loginAs(app, 'admin@a.com')

      const response = await request(app.getHttpServer())
        .post('/api/v1/tenants/current/logo')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('%PDF-1.4 no soy una imagen'), {
          filename: 'logo.png',
          contentType: 'image/png',
        })
        .expect(400)
      expect(response.body.code).toBe('TENANT_INVALID_LOGO')
    })
  })
})
