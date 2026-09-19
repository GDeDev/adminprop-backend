import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import request from 'supertest'

import { InMemoryFeatureFlagAdapter } from '../src/platform/feature-flags/adapters/in-memory.feature-flag-adapter'
import { FeatureFlagPort } from '../src/platform/feature-flags/feature-flag.port'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginAs, loginToPortalAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'
import { waitFor } from './utils/wait-for'

/**
 * Módulo de referencia de punta a punta, contra Postgres y pg-boss reales:
 * HTTP → Command/Query → Domain Service → Repository (con tenant) → Postgres,
 * más evento entre módulos, StoragePort, feature flag y acción pesada con
 * AsyncJob.
 */
describe('Módulo de referencia _example (e2e, Postgres)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let flags: InMemoryFeatureFlagAdapter
  let tenantA: { id: string }
  let tokenA: string

  const api = () => request(app.getHttpServer())
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

  const createItem = (body: object, token = tokenA) =>
    api().post('/api/v1/examples').set(auth(token)).send(body)

  beforeAll(async () => {
    app = await createTestApp()
    prisma = app.get(PrismaService)
    // En los tests el proveedor es `memory`: se prende el flag por tenant.
    flags = app.get(FeatureFlagPort) as InMemoryFeatureFlagAdapter
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await resetDatabase(prisma)
    tenantA = await createTenant(prisma, 'tenant-a')
    await createUser(prisma, { tenantId: tenantA.id, email: 'emp@a.com' })
    tokenA = await loginAs(app, 'emp@a.com')
  })

  describe('alta y consulta', () => {
    it('crea un ítem y el dinero vuelve como string con dos decimales', async () => {
      const response = await createItem({
        name: '  Casa  1 ',
        price: '150333.3',
      }).expect(201)

      expect(response.body.data).toMatchObject({
        name: 'Casa 1',
        price: '150333.30',
        attachmentUrl: null,
      })

      const found = await api()
        .get(`/api/v1/examples/${response.body.data.id}`)
        .set(auth(tokenA))
        .expect(200)
      expect(found.body.data.price).toBe('150333.30')
    })

    it('un ítem de otra inmobiliaria es un 404, no un 403', async () => {
      const created = await createItem({ name: 'Casa', price: '10' })
      const tenantB = await createTenant(prisma, 'tenant-b')
      await createUser(prisma, { tenantId: tenantB.id, email: 'emp@b.com' })
      const tokenB = await loginAs(app, 'emp@b.com')

      const response = await api()
        .get(`/api/v1/examples/${created.body.data.id}`)
        .set(auth(tokenB))
        .expect(404)

      expect(response.body.code).toBe('EXAMPLE_ITEM_NOT_FOUND')
    })

    it('el mismo nombre en otra inmobiliaria sí se permite', async () => {
      await createItem({ name: 'Casa', price: '10' }).expect(201)
      const tenantB = await createTenant(prisma, 'tenant-b')
      await createUser(prisma, { tenantId: tenantB.id, email: 'emp@b.com' })
      const tokenB = await loginAs(app, 'emp@b.com')

      await createItem({ name: 'Casa', price: '10' }, tokenB).expect(201)
    })

    it('un nombre repetido en la misma inmobiliaria es un 409', async () => {
      await createItem({ name: 'Casa', price: '10' }).expect(201)

      const response = await createItem({ name: 'Casa', price: '20' }).expect(
        409,
      )
      expect(response.body.code).toBe('EXAMPLE_ITEM_NAME_TAKEN')
    })

    it('un precio no positivo es un 422 (regla de negocio)', async () => {
      const response = await createItem({ name: 'Casa', price: '0' }).expect(
        422,
      )
      expect(response.body).toMatchObject({
        statusCode: 422,
        error: 'Unprocessable Entity',
        code: 'EXAMPLE_ITEM_INVALID_PRICE',
      })
    })

    it('un precio enviado como número es un 400: el dinero viaja como string', async () => {
      await createItem({ name: 'Casa', price: 10.5 }).expect(400)
    })

    it('el alta queda en el historial de auditoría, con tenant y autor', async () => {
      const created = await createItem({ name: 'Casa', price: '10' })

      const log = await prisma.auditLog.findFirst({
        where: { entityId: created.body.data.id },
      })
      expect(log).toMatchObject({
        tenantId: tenantA.id,
        entity: 'ExampleItem',
        action: 'CREATE',
        userEmail: 'emp@a.com',
      })
    })

    it('sin token es 401 y un propietario (portal) es 403', async () => {
      await createItem({ name: 'Casa', price: '10' }, 'no-token').expect(401)

      await createUser(prisma, {
        tenantId: tenantA.id,
        email: 'owner@a.com',
        role: Role.OWNER,
      })
      const ownerToken = await loginToPortalAs(app, 'tenant-a', 'owner@a.com')
      await createItem({ name: 'Casa', price: '10' }, ownerToken).expect(403)
    })
  })

  describe('evento entre módulos', () => {
    it('_example-listener registra la actividad al recibir el evento por pg-boss', async () => {
      const created = await createItem({ name: 'Casa', price: '99.90' })
      const itemId = created.body.data.id

      await waitFor(
        async () =>
          (await prisma.exampleActivity.count({
            where: { exampleItemId: itemId },
          })) === 1,
      )

      const activity = await prisma.exampleActivity.findFirst({
        where: { exampleItemId: itemId },
      })
      // El consumidor corrió dentro del tenant del alta.
      expect(activity).toMatchObject({
        tenantId: tenantA.id,
        description: 'Se creó "Casa" con precio 99.90',
      })
    }, 30_000)
  })

  describe('adjunto por StoragePort', () => {
    it('guarda el archivo en la carpeta del tenant y lo sirve por su URL', async () => {
      const created = await createItem({ name: 'Casa', price: '10' })
      const itemId = created.body.data.id

      const response = await api()
        .post(`/api/v1/examples/${itemId}/attachment`)
        .set(auth(tokenA))
        .attach('file', Buffer.from('%PDF-1.4 prueba'), {
          filename: 'contrato.pdf',
          contentType: 'application/pdf',
        })
        .expect(201)

      const url: string = response.body.data.attachmentUrl
      expect(url).toContain(`/files/tenants/${tenantA.id}/examples/${itemId}/`)

      const file = await api().get(new URL(url).pathname).expect(200)
      expect(file.body.toString()).toBe('%PDF-1.4 prueba')
    })

    it('rechaza un tipo de archivo no permitido', async () => {
      const created = await createItem({ name: 'Casa', price: '10' })

      await api()
        .post(`/api/v1/examples/${created.body.data.id}/attachment`)
        .set(auth(tokenA))
        .attach('file', Buffer.from('#!/bin/sh'), {
          filename: 'script.sh',
          contentType: 'application/x-sh',
        })
        .expect(400)
    })
  })

  describe('acción pesada: 202 + AsyncJob + pg-boss', () => {
    const recalculate = (body: object) =>
      api().post('/api/v1/examples/recalculate').set(auth(tokenA)).send(body)

    it('con el flag apagado para el tenant responde 403 FEATURE_DISABLED', async () => {
      const response = await recalculate({ percentage: '5' }).expect(403)

      expect(response.body.code).toBe('FEATURE_DISABLED')
    })

    it('encola, reintenta la falla simulada y termina el trabajo', async () => {
      flags.enable('example-bulk-recalculate', tenantA.id)
      const created = await createItem({ name: 'Casa', price: '150333.33' })

      const accepted = await recalculate({
        percentage: '5',
        simulateTransientFailure: true,
      }).expect(202)
      const { jobId } = accepted.body.data

      let status: { status: string; processedItems: number } | undefined
      await waitFor(
        async () => {
          const response = await api()
            .get(`/api/v1/jobs/${jobId}/status`)
            .set(auth(tokenA))
          status = response.body.data
          return status?.status === 'COMPLETED'
        },
        { timeoutMs: 40_000, intervalMs: 500 },
      )

      expect(status).toMatchObject({ status: 'COMPLETED', processedItems: 1 })

      // 5% de 150333.33 con ROUND_HALF_UP: 157850.00.
      const item = await api()
        .get(`/api/v1/examples/${created.body.data.id}`)
        .set(auth(tokenA))
      expect(item.body.data.price).toBe('157850.00')
    }, 60_000)

    it('un porcentaje inválido es un 422 inmediato, sin crear el trabajo', async () => {
      flags.enable('example-bulk-recalculate', tenantA.id)

      await recalculate({ percentage: '150' }).expect(422)
      expect(await prisma.asyncJob.count()).toBe(0)
    })
  })
})
