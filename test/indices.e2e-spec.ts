import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import request from 'supertest'

import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'

/** Índices ICL/IPC (spec Fase 9, 3.8): carga manual, globales entre inmobiliarias. */
describe('Índices (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let adminToken: string
  let employeeToken: string
  let adminBToken: string

  const api = (token: string) => ({
    get: (url: string) =>
      request(app.getHttpServer())
        .get(`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`),
    post: (url: string) =>
      request(app.getHttpServer())
        .post(`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`),
  })

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
    const tenantA = await createTenant(prisma, 'tenant-a')
    const tenantB = await createTenant(prisma, 'tenant-b')
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
  })

  it('un admin carga un valor y queda con 6 decimales y fuente manual', async () => {
    const response = await api(adminToken)
      .post('/indices')
      .send({ indexType: 'ICL', period: '2026-03', value: '1500.5' })
      .expect(201)

    expect(response.body.data).toMatchObject({
      indexType: 'ICL',
      period: '2026-03',
      value: '1500.500000',
      source: 'manual',
    })
  })

  it('un empleado no puede cargar (403) pero sí consultar', async () => {
    await api(employeeToken)
      .post('/indices')
      .send({ indexType: 'ICL', period: '2026-03', value: '1500' })
      .expect(403)
    await api(employeeToken).get('/indices?type=ICL').expect(200)
  })

  it('el mismo mes dos veces → 409; otro índice el mismo mes, sí', async () => {
    await api(adminToken)
      .post('/indices')
      .send({ indexType: 'ICL', period: '2026-03', value: '1500' })
      .expect(201)
    const response = await api(adminToken)
      .post('/indices')
      .send({ indexType: 'ICL', period: '2026-03', value: '1501' })
      .expect(409)
    expect(response.body.code).toBe('INDEX_PERIOD_TAKEN')

    await api(adminToken)
      .post('/indices')
      .send({ indexType: 'IPC', period: '2026-03', value: '9000' })
      .expect(201)
  })

  it('período o valor inválido → 400', async () => {
    const period = await api(adminToken)
      .post('/indices')
      .send({ indexType: 'ICL', period: '2026-13', value: '1500' })
      .expect(400)
    expect(period.body.code).toBe('INDEX_INVALID_PERIOD')

    const zero = await api(adminToken)
      .post('/indices')
      .send({ indexType: 'ICL', period: '2026-03', value: '0' })
      .expect(400)
    expect(zero.body.code).toBe('INDEX_INVALID_VALUE')

    await api(adminToken)
      .post('/indices')
      .send({ indexType: 'ICL', period: '2026-03', value: 1500 })
      .expect(400)
  })

  it('los índices son globales: otra inmobiliaria ve lo que cargó la primera', async () => {
    await api(adminToken)
      .post('/indices')
      .send({ indexType: 'ICL', period: '2026-03', value: '1500' })
      .expect(201)
    await api(adminToken)
      .post('/indices')
      .send({ indexType: 'ICL', period: '2026-04', value: '1600' })
      .expect(201)

    const response = await api(adminBToken).get('/indices?type=ICL').expect(200)
    expect(response.body.data.map((v: { period: string }) => v.period)).toEqual(
      ['2026-04', '2026-03'],
    )

    await api(adminBToken).get('/indices?type=UVA').expect(400)
  })
})
