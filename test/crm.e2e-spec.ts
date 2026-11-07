import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import request from 'supertest'

import { seedBaseMasterData } from '../prisma/lib/master-data-seed'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'
import { waitFor } from './utils/wait-for'

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

/** CRM (Fase 23): tablero, consultas, notas, asignación, WhatsApp y analítica. */
describe('CRM (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string }
  let tenantB: { id: string }
  let adminToken: string
  let employeeToken: string
  let adminBToken: string
  let employeeId: string
  let adminBId: string
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
    patch: (url: string) =>
      request(app.getHttpServer())
        .patch(`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`),
  })

  const create = async (
    body: Record<string, unknown> = {},
    token = adminToken,
  ) =>
    (
      await api(token)
        .post('/crm/inquiries')
        .send({ name: 'Ana', phone: '221 555 1234', source: 'PHONE', ...body })
        .expect(201)
    ).body.data as { id: string; boardPosition: number; stage: string }

  const pipeline = async (token = adminToken, query = '') =>
    (await api(token).get(`/crm/pipeline${query}`).expect(200)).body.data
      .columns as {
      stage: string
      total: number
      cards: { id: string; name: string; boardPosition: number }[]
    }[]

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
    tenantB = await createTenant(prisma, 'tenant-b')
    await seedBaseMasterData(prisma, tenantA.id, { withSampleCities: true })
    await createUser(prisma, {
      tenantId: tenantA.id,
      email: 'admin@a.com',
      role: Role.ADMIN,
    })
    employeeId = (
      await createUser(prisma, { tenantId: tenantA.id, email: 'emp@a.com' })
    ).id
    adminBId = (
      await createUser(prisma, {
        tenantId: tenantB.id,
        email: 'admin@b.com',
        role: Role.ADMIN,
      })
    ).id
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
        })
        .expect(201)
    ).body.data.id
  })

  it('exige sesión: sin token es 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/crm/pipeline').expect(401)
  })

  it('carga una consulta a mano: entra en NEW arriba, con actividad CREATED', async () => {
    const first = await create({ name: 'Ana', propertyId })
    const second = await create({ name: 'Beto', email: 'BETO@mail.com' })
    expect(first.stage).toBe('NEW')
    expect(second.boardPosition).toBeLessThan(first.boardPosition)

    const columns = await pipeline()
    expect(columns[0].cards.map((c) => c.name)).toEqual(['Beto', 'Ana'])

    const detail = await api(adminToken)
      .get(`/crm/inquiries/${first.id}`)
      .expect(200)
    expect(detail.body.data).toMatchObject({
      name: 'Ana',
      property: { id: propertyId, address: 'Calle 7 1234' },
      hasWhatsApp: true,
    })
    expect(
      detail.body.data.activities.map((a: { type: string }) => a.type),
    ).toEqual(['CREATED'])
  })

  it('una consulta necesita email o teléfono, y el origen manual es cerrado', async () => {
    await api(adminToken)
      .post('/crm/inquiries')
      .send({ name: 'Sin datos', source: 'MANUAL' })
      .expect(422)
    await api(adminToken)
      .post('/crm/inquiries')
      .send({ name: 'X', phone: '221', source: 'PORTAL' })
      .expect(400)
  })

  it('una consulta sin propiedad es válida ("consulta general")', async () => {
    const one = await create({ name: 'General' })
    const detail = await api(adminToken).get(`/crm/inquiries/${one.id}`)
    expect(detail.body.data.property).toBeNull()
  })

  it('mueve entre columnas con orden estable entre vecinos', async () => {
    const a = await create({ name: 'A' })
    const b = await create({ name: 'B' })
    const c = await create({ name: 'C' })
    // Todas a CONTACTED, una detrás de otra.
    for (const card of [a, b, c]) {
      await api(adminToken)
        .patch(`/crm/inquiries/${card.id}/stage`)
        .send({ stage: 'CONTACTED' })
        .expect(200)
    }
    // Arriba quedó la última movida: C, B, A. Se mete A entre C y B.
    await api(adminToken)
      .patch(`/crm/inquiries/${a.id}/stage`)
      .send({ stage: 'CONTACTED', beforeId: c.id, afterId: b.id })
      .expect(200)

    const column = (await pipeline())[1]
    expect(column.cards.map((x) => x.name)).toEqual(['C', 'A', 'B'])
    expect(column.total).toBe(3)
  })

  it('CLOSED_LOST exige motivo; reabrir está permitido y queda en la línea de tiempo', async () => {
    const one = await create()
    const missing = await api(adminToken)
      .patch(`/crm/inquiries/${one.id}/stage`)
      .send({ stage: 'CLOSED_LOST' })
      .expect(422)
    expect(missing.body.code).toBe('LOST_REASON_REQUIRED')

    const lost = await api(adminToken)
      .patch(`/crm/inquiries/${one.id}/stage`)
      .send({ stage: 'CLOSED_LOST', lostReason: 'Precio' })
      .expect(200)
    expect(lost.body.data.stage).toBe('CLOSED_LOST')

    await api(adminToken)
      .patch(`/crm/inquiries/${one.id}/stage`)
      .send({ stage: 'CONTACTED' })
      .expect(200)

    const detail = (
      await api(adminToken).get(`/crm/inquiries/${one.id}`).expect(200)
    ).body.data
    expect(detail).toMatchObject({
      stage: 'CONTACTED',
      lostReason: null,
      closedAt: null,
    })
    expect(
      detail.activities.filter(
        (a: { type: string }) => a.type === 'STAGE_CHANGED',
      ),
    ).toHaveLength(2)
  })

  it('CLOSED_WON guarda el cierre; un contrato inexistente (o ajeno) es 404', async () => {
    const one = await create()
    // Antes se guardaba cualquier id como contrato vinculado.
    const unknown = await api(adminToken)
      .patch(`/crm/inquiries/${one.id}/stage`)
      .send({ stage: 'CLOSED_WON', contractId: UNKNOWN_ID })
      .expect(404)
    expect(unknown.body.code).toBe('CONTRACT_NOT_FOUND')

    const won = await api(adminToken)
      .patch(`/crm/inquiries/${one.id}/stage`)
      .send({ stage: 'CLOSED_WON' })
      .expect(200)
    expect(won.body.data.stage).toBe('CLOSED_WON')
    const detail = await api(adminToken).get(`/crm/inquiries/${one.id}`)
    expect(detail.body.data).toMatchObject({ contractId: null })
    expect(detail.body.data.closedAt).toEqual(expect.any(String))
  })

  it('asigna a personal activo; a otro tenant es 422 ASSIGNEE_INVALID y avisa al asignado', async () => {
    const one = await create({ name: 'Con dueño' })

    const invalid = await api(adminToken)
      .patch(`/crm/inquiries/${one.id}/assign`)
      .send({ userId: adminBId })
      .expect(422)
    expect(invalid.body.code).toBe('ASSIGNEE_INVALID')

    const assigned = await api(adminToken)
      .patch(`/crm/inquiries/${one.id}/assign`)
      .send({ userId: employeeId })
      .expect(200)
    expect(assigned.body.data.assignedTo).toMatchObject({ id: employeeId })

    await waitFor(async () => {
      const alerts = await api(employeeToken).get('/automations/alerts')
      return alerts.body.data.data.some(
        (a: { type: string }) => a.type === 'INQUIRY_ASSIGNED',
      )
    })

    const mine = await pipeline(adminToken, `?assignedToId=${employeeId}`)
    expect(mine[0].total).toBe(1)
    const none = await pipeline(adminToken, '?unassigned=true')
    expect(none[0].total).toBe(0)

    await api(adminToken)
      .patch(`/crm/inquiries/${one.id}/assign`)
      .send({ userId: null })
      .expect(200)
    expect((await pipeline(adminToken, '?unassigned=true'))[0].total).toBe(1)
  })

  it('las notas quedan en la línea de tiempo y no se pueden editar ni borrar', async () => {
    const one = await create()
    const note = await api(employeeToken)
      .post(`/crm/inquiries/${one.id}/notes`)
      .send({ body: 'Quiere mascotas' })
      .expect(201)
    expect(note.body.data).toMatchObject({
      type: 'NOTE',
      payload: { body: 'Quiere mascotas' },
      author: { fullName: expect.any(String) },
    })
    await api(employeeToken)
      .post(`/crm/inquiries/${one.id}/notes`)
      .send({ body: 'x'.repeat(2001) })
      .expect(400)
    await request(app.getHttpServer())
      .delete(`/api/v1/crm/inquiries/${one.id}/notes/${note.body.data.id}`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(404)
  })

  it('el seguimiento se edita y deja actividad FOLLOW_UP_SET', async () => {
    const one = await create()
    const updated = await api(adminToken)
      .patch(`/crm/inquiries/${one.id}`)
      .send({ nextActionAt: '2026-12-01' })
      .expect(200)
    expect(updated.body.data.nextActionAt).toBe('2026-12-01')
    expect(
      updated.body.data.activities.map((a: { type: string }) => a.type),
    ).toContain('FOLLOW_UP_SET')
    await api(adminToken)
      .patch(`/crm/inquiries/${one.id}`)
      .send({ nextActionAt: 'mañana' })
      .expect(400)
  })

  it('registrar un contacto saca la consulta de NEW y fija el último contacto', async () => {
    const one = await create()
    const card = await api(adminToken)
      .post(`/crm/inquiries/${one.id}/contact-attempts`)
      .send({ channel: 'WHATSAPP' })
      .expect(201)
    expect(card.body.data).toMatchObject({ stage: 'CONTACTED' })
    expect(card.body.data.lastContactAt).toEqual(expect.any(String))
  })

  it('link de WhatsApp: con teléfono arma wa.me con la plantilla; sin teléfono, url null', async () => {
    const withPhone = await create({ name: 'Ana', propertyId })
    const link = await api(adminToken)
      .get(`/crm/inquiries/${withPhone.id}/whatsapp-link`)
      .expect(200)
    expect(link.body.data.url).toMatch(/^https:\/\/wa\.me\/549221/)
    expect(link.body.data.message).toContain('Ana')
    expect(link.body.data.message).toContain('Calle 7 1234')

    const noPhone = await create({
      name: 'Sin tel',
      phone: undefined,
      email: 'x@mail.com',
    })
    const none = await api(adminToken)
      .get(`/crm/inquiries/${noPhone.id}/whatsapp-link`)
      .expect(200)
    expect(none.body.data.url).toBeNull()
    expect(none.body.data.message).toContain('Sin tel')

    await api(adminToken)
      .get(`/crm/inquiries/${withPhone.id}/whatsapp-link?templateKey=NOPE`)
      .expect(404)
  })

  it('aislamiento: otro tenant no ve ni toca la consulta, por id directo tampoco', async () => {
    const one = await create({ name: 'Privada' })

    expect((await pipeline(adminBToken))[0].total).toBe(0)
    // Funciones y no requests ya armados: supertest levanta un servidor al crear
    // cada request y lo cierra al terminar el primero, así que los demás, creados
    // de antemano, fallaban con ECONNREFUSED.
    for (const makeRequest of [
      () => api(adminBToken).get(`/crm/inquiries/${one.id}`),
      () =>
        api(adminBToken)
          .patch(`/crm/inquiries/${one.id}/stage`)
          .send({ stage: 'CONTACTED' }),
      () =>
        api(adminBToken)
          .patch(`/crm/inquiries/${one.id}/assign`)
          .send({ userId: null }),
      () =>
        api(adminBToken)
          .post(`/crm/inquiries/${one.id}/notes`)
          .send({ body: 'hola' }),
      () => api(adminBToken).get(`/crm/inquiries/${one.id}/whatsapp-link`),
    ]) {
      const response = await makeRequest()
      expect(response.status).toBe(404)
      expect(response.body.code).toBe('INQUIRY_NOT_FOUND')
    }
    const list = await api(adminBToken).get('/crm/inquiries').expect(200)
    expect(list.body.data.pagination.total).toBe(0)
    const assignees = await api(adminBToken).get('/crm/assignees').expect(200)
    expect(assignees.body.data.map((a: { id: string }) => a.id)).toEqual([
      adminBId,
    ])
  })

  it('filtros del tablero: búsqueda, propiedad y origen; paginado por columna', async () => {
    await create({ name: 'María', propertyId, source: 'WHATSAPP' })
    await create({ name: 'Pedro', source: 'MANUAL' })

    const byQuery = await pipeline(adminToken, '?q=mar')
    expect(byQuery[0].cards.map((c) => c.name)).toEqual(['María'])
    const byProperty = await pipeline(adminToken, `?propertyId=${propertyId}`)
    expect(byProperty[0].total).toBe(1)
    const bySource = await pipeline(adminToken, '?source=MANUAL')
    expect(bySource[0].cards.map((c) => c.name)).toEqual(['Pedro'])

    const page = await api(adminToken)
      .get('/crm/inquiries?stage=NEW&limit=1&page=2')
      .expect(200)
    expect(page.body.data.data).toHaveLength(1)
    expect(page.body.data.pagination.total).toBe(2)
  })

  it('job crm.follow-up-reminder: avisa el seguimiento vencido una sola vez y no los de otro tenant', async () => {
    const due = await create({ name: 'Vencida' })
    const later = await create({ name: 'Futura' })
    await api(adminToken)
      .patch(`/crm/inquiries/${due.id}`)
      .send({ nextActionAt: '2020-01-01' })
      .expect(200)
    await api(adminToken)
      .patch(`/crm/inquiries/${later.id}`)
      .send({ nextActionAt: '2999-01-01' })
      .expect(200)

    const run = () =>
      api(adminToken)
        .post('/automations/jobs/crm.follow-up-reminder/run')
        .send({})
    await run().expect(202)
    const alerts = async (token: string) =>
      (await api(token).get('/automations/alerts').expect(200)).body.data
        .data as {
        type: string
        entityId: string
      }[]
    await waitFor(async () =>
      (await alerts(adminToken)).some((a) => a.type === 'INQUIRY_FOLLOW_UP'),
    )
    await run().expect(202)
    const mine = (await alerts(adminToken)).filter(
      (a) => a.type === 'INQUIRY_FOLLOW_UP',
    )
    expect(mine.map((a) => a.entityId)).toEqual([due.id])
    expect(
      (await alerts(adminBToken)).some((a) => a.type === 'INQUIRY_FOLLOW_UP'),
    ).toBe(false)
  })

  describe('analítica', () => {
    it('por propiedad: vistas, consultas por etapa y origen, conversión y serie diaria', async () => {
      const won = await create({ propertyId })
      await create({ propertyId, source: 'WHATSAPP' })
      await api(adminToken)
        .patch(`/crm/inquiries/${won.id}/stage`)
        .send({ stage: 'CLOSED_WON' })
        .expect(200)
      await prisma.propertyView.create({
        data: {
          tenantId: tenantA.id,
          propertyId,
          day: new Date(new Date().toISOString().slice(0, 10)),
          views: 7,
        },
      })

      const res = await api(adminToken)
        .get(`/crm/analytics/properties/${propertyId}`)
        .expect(200)
      expect(res.body.data).toMatchObject({
        views: 7,
        inquiries: 2,
        conversionRate: '50.0',
        byStage: { CLOSED_WON: 1, NEW: 1 },
        bySource: { PHONE: 1, WHATSAPP: 1 },
      })
      expect(res.body.data.daily).toHaveLength(30)

      await api(adminBToken)
        .get(`/crm/analytics/properties/${propertyId}`)
        .expect(404)
      await api(adminToken)
        .get(
          `/crm/analytics/properties/${propertyId}?from=2026-12-01&to=2026-01-01`,
        )
        .expect(422)
    })

    it('general: abiertas, sin asignar, primer contacto, conversión y top de propiedades', async () => {
      const a = await create({ propertyId })
      await create({ name: 'Otra' })
      await api(adminToken)
        .post(`/crm/inquiries/${a.id}/contact-attempts`)
        .send({ channel: 'PHONE' })
        .expect(201)

      const res = await api(adminToken)
        .get('/crm/analytics/overview')
        .expect(200)
      expect(res.body.data).toMatchObject({
        openCount: 2,
        unassignedCount: 2,
        conversionRate: '0.0',
        topProperties: [
          { propertyId, address: 'Calle 7 1234', inquiries: 1, views: 0 },
        ],
      })
      expect(res.body.data.averageFirstContactHours).not.toBeNull()

      const empty = await api(adminBToken)
        .get('/crm/analytics/overview')
        .expect(200)
      expect(empty.body.data).toMatchObject({
        openCount: 0,
        conversionRate: null,
        averageFirstContactHours: null,
        topProperties: [],
      })
    })
  })
})
