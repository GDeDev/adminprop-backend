import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import request from 'supertest'

import { seedBaseMasterData } from '../prisma/lib/master-data-seed'
import { FakeListingPublisher } from '../src/modules/crm/infrastructure/publishers/fake-listing-publisher'
import { PropertiesFacade } from '../src/modules/properties/public'
import { RequestContext } from '../src/shared/context/request-context'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'
import { waitFor } from './utils/wait-for'

/**
 * Multipublicación (Fase 23, 6) con el adapter simulado: OAuth de punta a
 * punta, publicar, pausar, errores de token y rechazo, cierre al alquilarse y
 * consultas entrantes.
 */
describe('CRM: multipublicación (e2e, Postgres, adapter simulado)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let fake: FakeListingPublisher
  let tenantA: { id: string }
  let tenantB: { id: string }
  let adminToken: string
  let employeeToken: string
  let adminBToken: string
  let propertyId: string

  const api = (token: string) => ({
    get: (url: string) =>
      request(app.getHttpServer())
        .get(`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`),
    post: (url: string) =>
      request(app.getHttpServer())
        .post(`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`),
    delete: (url: string) =>
      request(app.getHttpServer())
        .delete(`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`),
    patch: (url: string) =>
      request(app.getHttpServer())
        .patch(`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`),
  })

  /** Hace el recorrido del navegador: connect, portal (simulado) y callback. */
  const connectChannel = async (token = adminToken) => {
    const connect = await api(token)
      .post('/crm/channels/mercadolibre/connect')
      .expect(200)
    const url = connect.body.data.authorizeUrl as string
    const callback = await request(app.getHttpServer()).get(url).expect(302)
    return callback.header.location as string
  }

  const listingOf = async (token = adminToken, id = propertyId) =>
    (
      (await api(token).get(`/crm/properties/${id}/listings`).expect(200)).body
        .data as {
        channel: string
        status: string
        externalUrl: string | null
        lastError: string | null
        hasUnpublishedChanges: boolean
        canPublish: boolean
        missingForPublish: string[]
      }[]
    ).find((l) => l.channel === 'MERCADOLIBRE')!

  const publish = async (path = 'publish') => {
    const response = await api(adminToken)
      .post(`/crm/properties/${propertyId}/listings/mercadolibre/${path}`)
      .expect(202)
    const jobId = response.body.data.jobId as string
    await waitFor(async () => {
      const status = await api(adminToken).get(`/jobs/${jobId}/status`)
      return ['COMPLETED', 'FAILED'].includes(status.body.data.status)
    })
    return (await api(adminToken).get(`/jobs/${jobId}/status`)).body.data as {
      status: string
    }
  }

  beforeAll(async () => {
    await prisma.$connect()
    app = await createTestApp()
    fake = app.get(FakeListingPublisher)
  })

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    fake.reset()
    await resetDatabase(prisma)
    tenantA = await createTenant(prisma, 'tenant-a')
    tenantB = await createTenant(prisma, 'tenant-b')
    await seedBaseMasterData(prisma, tenantA.id, { withSampleCities: true })
    await createUser(prisma, {
      tenantId: tenantA.id,
      email: 'admin@a.com',
      role: Role.ADMIN,
    })
    await createUser(prisma, { tenantId: tenantA.id, email: 'emp@a.com' })
    await createUser(prisma, {
      tenantId: tenantB.id,
      email: 'admin@b.com',
      role: Role.ADMIN,
    })
    adminToken = await loginAs(app, 'admin@a.com')
    employeeToken = await loginAs(app, 'emp@a.com')
    adminBToken = await loginAs(app, 'admin@b.com')

    const location = await prisma.location.findFirstOrThrow({
      where: { tenantId: tenantA.id, name: 'Tolosa' },
    })
    const type = await prisma.propertyType.findFirstOrThrow({
      where: { tenantId: tenantA.id, name: 'Casa' },
    })
    propertyId = (
      await api(adminToken)
        .post('/properties')
        .send({
          address: 'Calle 7 1234',
          locationId: location.id,
          propertyTypeId: type.id,
          listingPrice: '150000',
          publicDescription: 'Casa de dos plantas con patio',
        })
        .expect(201)
    ).body.data.id
    await prisma.propertyPhoto.create({
      data: {
        tenantId: tenantA.id,
        propertyId,
        storageKey: 'k1',
        url: 'https://cdn.local/k1.jpg',
        position: 0,
      },
    })
  })

  describe('canales y OAuth', () => {
    it('lista los tres canales: Mercado Libre desconectado y los otros dos no disponibles', async () => {
      const response = await api(employeeToken).get('/crm/channels').expect(200)
      expect(
        response.body.data.map((c: { channel: string; status: string }) => [
          c.channel,
          c.status,
        ]),
      ).toEqual([
        ['MERCADOLIBRE', 'DISCONNECTED'],
        ['ZONAPROP', 'UNAVAILABLE'],
        ['ARGENPROP', 'UNAVAILABLE'],
      ])
      expect(response.body.data[1].unavailableReason).toEqual(
        expect.any(String),
      )
    })

    it('conectar y desconectar son sólo del admin', async () => {
      await api(employeeToken)
        .post('/crm/channels/mercadolibre/connect')
        .expect(403)
      await api(employeeToken).delete('/crm/channels/mercadolibre').expect(403)
      await api(adminToken).delete('/crm/channels/zonaprop').expect(422)
    })

    it('recorrido completo del OAuth: conecta, guarda los tokens cifrados y nunca los devuelve', async () => {
      const location = await connectChannel()
      expect(location).toBe('/configuracion/canales?connected=mercadolibre')

      const channels = await api(adminToken).get('/crm/channels').expect(200)
      expect(channels.body.data[0]).toMatchObject({
        status: 'CONNECTED',
        accountLabel: 'Cuenta de prueba (simulada)',
      })
      expect(JSON.stringify(channels.body)).not.toMatch(/token|fake-access/i)

      const row = await prisma.listingChannelAccount.findFirstOrThrow({
        where: { tenantId: tenantA.id },
      })
      expect(row.accessTokenEnc).toEqual(expect.any(String))
      expect(row.accessTokenEnc).not.toContain('fake-access')

      // Otra inmobiliaria no ve la cuenta.
      const other = await api(adminBToken).get('/crm/channels').expect(200)
      expect(other.body.data[0].status).toBe('DISCONNECTED')
    })

    it('un state manipulado o de otro canal se rechaza y no conecta nada', async () => {
      const connect = await api(adminToken)
        .post('/crm/channels/mercadolibre/connect')
        .expect(200)
      const state = new URL(
        connect.body.data.authorizeUrl,
        'http://x',
      ).searchParams.get('state') as string

      const bad = await request(app.getHttpServer())
        .get(
          `/api/v1/crm/channels/mercadolibre/callback?code=fake-code&state=${state}zz`,
        )
        .expect(400)
      expect(bad.body.code).toBe('OAUTH_STATE_INVALID')
      expect(await prisma.listingChannelAccount.count()).toBe(0)
    })

    it('un código inválido vuelve al backoffice con error y no conecta', async () => {
      const connect = await api(adminToken)
        .post('/crm/channels/mercadolibre/connect')
        .expect(200)
      const state = new URL(
        connect.body.data.authorizeUrl,
        'http://x',
      ).searchParams.get('state') as string
      const response = await request(app.getHttpServer())
        .get(
          `/api/v1/crm/channels/mercadolibre/callback?code=otro&state=${state}`,
        )
        .expect(302)
      expect(response.header.location).toContain('error=connect_failed')
      const channels = await api(adminToken).get('/crm/channels')
      expect(channels.body.data[0].status).toBe('DISCONNECTED')
    })

    it('desconectar borra los tokens', async () => {
      await connectChannel()
      await api(adminToken).delete('/crm/channels/mercadolibre').expect(200)
      const row = await prisma.listingChannelAccount.findFirstOrThrow()
      expect(row).toMatchObject({
        status: 'DISCONNECTED',
        accessTokenEnc: null,
        refreshTokenEnc: null,
      })
    })
  })

  describe('publicaciones', () => {
    it('no publica si falta algo (422 con la lista) ni sin cuenta conectada (409)', async () => {
      await prisma.propertyPhoto.deleteMany()
      const notReady = await api(adminToken)
        .post(`/crm/properties/${propertyId}/listings/mercadolibre/publish`)
        .expect(422)
      expect(notReady.body.code).toBe('LISTING_NOT_READY')
      expect(notReady.body.errors).toEqual([
        expect.objectContaining({ message: 'Falta al menos una foto' }),
      ])

      await prisma.propertyPhoto.create({
        data: {
          tenantId: tenantA.id,
          propertyId,
          storageKey: 'k1',
          url: 'https://cdn.local/k1.jpg',
          position: 0,
        },
      })
      const noChannel = await api(adminToken)
        .post(`/crm/properties/${propertyId}/listings/mercadolibre/publish`)
        .expect(409)
      expect(noChannel.body.code).toBe('CHANNEL_NOT_CONNECTED')
    })

    it('publica, pausa, reanuda y cierra; el estado refleja el portal', async () => {
      await connectChannel()
      expect(await listingOf()).toMatchObject({
        status: 'NOT_PUBLISHED',
        canPublish: true,
        missingForPublish: [],
      })

      expect((await publish()).status).toBe('COMPLETED')
      const published = await listingOf()
      expect(published).toMatchObject({
        status: 'PUBLISHED',
        hasUnpublishedChanges: false,
      })
      expect(published.externalUrl).toContain('https://fake.local/items/')

      const base = `/crm/properties/${propertyId}/listings/mercadolibre`
      expect(
        (await api(adminToken).post(`${base}/pause`).expect(200)).body.data
          .status,
      ).toBe('PAUSED')
      await api(adminToken).post(`${base}/pause`).expect(409)
      expect(
        (await api(employeeToken).post(`${base}/resume`).expect(200)).body.data
          .status,
      ).toBe('PUBLISHED')
      expect(
        (await api(adminToken).post(`${base}/close`).expect(200)).body.data
          .status,
      ).toBe('CLOSED')
    })

    it('editar la propiedad publicada marca "cambios sin publicar" y actualizar los sincroniza', async () => {
      await connectChannel()
      await publish()
      await api(adminToken)
        .patch(`/properties/${propertyId}`)
        .send({ listingPrice: '175000' })
        .expect(200)
      expect((await listingOf()).hasUnpublishedChanges).toBe(true)

      expect((await publish()).status).toBe('COMPLETED')
      expect((await listingOf()).hasUnpublishedChanges).toBe(false)
    })

    it('un rechazo del portal deja ERROR con los motivos y se reintenta', async () => {
      await connectChannel()
      fake.failNext('REJECTED')
      expect((await publish()).status).toBe('FAILED')
      expect(await listingOf()).toMatchObject({
        status: 'ERROR',
        lastError: expect.stringContaining('La categoría no admite'),
      })

      expect((await publish('retry')).status).toBe('COMPLETED')
      expect((await listingOf()).status).toBe('PUBLISHED')

      // Reintentar algo que no está en error es un 409.
      await api(adminToken)
        .post(`/crm/properties/${propertyId}/listings/mercadolibre/retry`)
        .expect(409)
    })

    it('token vencido sin renovar: el canal y la publicación pasan a ERROR, se avisa y reconectar + reintentar anda', async () => {
      await connectChannel()
      fake.failNext('TOKEN_EXPIRED')
      expect((await publish()).status).toBe('FAILED')

      expect((await listingOf()).status).toBe('ERROR')
      const channels = await api(adminToken).get('/crm/channels')
      expect(channels.body.data[0].status).toBe('ERROR')
      const alerts = await api(employeeToken).get('/automations/alerts')
      expect(
        alerts.body.data.data.some(
          (a: { type: string }) => a.type === 'LISTING_CHANNEL_ERROR',
        ),
      ).toBe(true)

      await connectChannel()
      expect((await publish('retry')).status).toBe('COMPLETED')
      expect((await listingOf()).status).toBe('PUBLISHED')
    })

    it('un token rechazado que sí se renueva no molesta', async () => {
      await connectChannel()
      fake.failNext('TOKEN_REJECTED')
      expect((await publish()).status).toBe('COMPLETED')
    })

    it('aislamiento: otra inmobiliaria no ve ni toca las publicaciones de esta propiedad', async () => {
      await connectChannel()
      await publish()
      await api(adminBToken)
        .get(`/crm/properties/${propertyId}/listings`)
        .expect(404)
      await api(adminBToken)
        .post(`/crm/properties/${propertyId}/listings/mercadolibre/pause`)
        .expect(404)
      expect(
        await prisma.propertyListing.count({ where: { tenantId: tenantB.id } }),
      ).toBe(0)
    })

    it('al alquilarse la propiedad, sus publicaciones activas se cierran solas (A-87)', async () => {
      await connectChannel()
      await publish()

      await RequestContext.run({ correlationId: 'test' }, () =>
        RequestContext.runInTenant(tenantA.id, () =>
          app
            .get(PropertiesFacade)
            .attachContract(propertyId, '00000000-0000-4000-8000-000000000001'),
        ),
      )

      await waitFor(async () => (await listingOf()).status === 'CLOSED')
    })
  })

  describe('consultas entrantes', () => {
    it('el job trae las consultas del portal al CRM, sin duplicarlas', async () => {
      await connectChannel()
      await publish()
      const externalListingId = (
        await prisma.propertyListing.findFirstOrThrow()
      ).externalId as string
      fake.simulateInquiry({
        externalId: 'q-1',
        name: 'Interesada ML',
        externalListingId,
      })

      const run = () =>
        api(adminToken)
          .post('/automations/jobs/crm.pull-channel-inquiries/run')
          .send({})
          .expect(202)
      await run()
      await waitFor(
        async () =>
          (await prisma.publicInquiry.count({
            where: { source: 'MERCADOLIBRE' },
          })) === 1,
      )
      await run()
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(await prisma.publicInquiry.count()).toBe(1)

      const inquiry = await prisma.publicInquiry.findFirstOrThrow()
      expect(inquiry).toMatchObject({
        stage: 'NEW',
        propertyId,
        email: null,
        phone: null,
        externalId: 'q-1',
      })
      const pipeline = await api(adminToken).get('/crm/pipeline').expect(200)
      expect(pipeline.body.data.columns[0].cards[0]).toMatchObject({
        name: 'Interesada ML',
        source: 'MERCADOLIBRE',
        hasWhatsApp: false,
      })
    })
  })
})
