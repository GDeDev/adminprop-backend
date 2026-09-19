import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import request from 'supertest'

import { AsyncJobsFacade } from '../src/modules/jobs/public'
import { RequestContext } from '../src/shared/context/request-context'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginAs, loginToPortalAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'

/**
 * `GET /jobs/:id/status` y el ciclo de vida de un AsyncJob, contra Postgres.
 */
describe('Jobs (e2e, Postgres)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let jobs: AsyncJobsFacade
  let tenantA: { id: string }
  let tokenA: string

  const inTenant = <T>(tenantId: string, fn: () => Promise<T>) =>
    RequestContext.run({ correlationId: 'test' }, () =>
      RequestContext.runInTenant(tenantId, fn),
    )

  const getStatus = (id: string, token: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/jobs/${id}/status`)
      .set('Authorization', `Bearer ${token}`)

  beforeAll(async () => {
    app = await createTestApp()
    prisma = app.get(PrismaService)
    jobs = app.get(AsyncJobsFacade)
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

  it('muestra el avance de un trabajo en curso', async () => {
    const jobId = await inTenant(tenantA.id, async () => {
      const id = await jobs.start('regenerate-pdfs', { totalItems: 4 })
      await jobs.markProcessing(id)
      await jobs.recordItem(id, 'succeeded')
      return id
    })

    const response = await getStatus(jobId, tokenA).expect(200)

    expect(response.body.data).toMatchObject({
      id: jobId,
      type: 'regenerate-pdfs',
      status: 'PROCESSING',
      totalItems: 4,
      processedItems: 1,
      failedItems: 0,
      progress: 25,
      finishedAt: null,
    })
  })

  it('al cerrarlo con algún ítem fallido queda COMPLETED_WITH_ERRORS', async () => {
    const jobId = await inTenant(tenantA.id, async () => {
      const id = await jobs.start('payment-reminders', { totalItems: 2 })
      await jobs.recordItem(id, 'succeeded')
      await jobs.recordItem(id, 'failed')
      await jobs.complete(id, { failed: ['contrato-7'] })
      // Cerrar dos veces (un reintento de la cola) no cambia nada.
      await jobs.complete(id)
      return id
    })

    const response = await getStatus(jobId, tokenA).expect(200)

    expect(response.body.data).toMatchObject({
      status: 'COMPLETED_WITH_ERRORS',
      progress: 100,
      result: { failed: ['contrato-7'] },
    })
    expect(response.body.data.finishedAt).toBeTruthy()
  })

  it('un trabajo de otra inmobiliaria da 404, no 403', async () => {
    const tenantB = await createTenant(prisma, 'tenant-b')
    await createUser(prisma, { tenantId: tenantB.id, email: 'emp@b.com' })
    const tokenB = await loginAs(app, 'emp@b.com')
    const jobId = await inTenant(tenantA.id, () => jobs.start('x'))

    const response = await getStatus(jobId, tokenB).expect(404)

    expect(response.body.code).toBe('ASYNC_JOB_NOT_FOUND')
  })

  it('un propietario del mismo tenant no puede consultar trabajos del backoffice', async () => {
    await createUser(prisma, {
      tenantId: tenantA.id,
      email: 'owner@a.com',
      role: Role.OWNER,
    })
    const ownerToken = await loginToPortalAs(app, 'tenant-a', 'owner@a.com')
    const jobId = await inTenant(tenantA.id, () => jobs.start('x'))

    await getStatus(jobId, ownerToken).expect(403)
  })

  it('un id que no es UUID es un 400, no un error de base', async () => {
    await getStatus('no-es-uuid', tokenA).expect(400)
  })
})
