import { INestApplication } from '@nestjs/common'
import { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { Role } from '@prisma/client'
import request from 'supertest'

import { seedBaseMasterData } from '../prisma/lib/master-data-seed'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { JobRunner } from '../src/modules/automations/application/job-runner'
import { JobScheduler } from '../src/modules/automations/application/job-scheduler'
import { JobExecutionRepository } from '../src/modules/automations/domain/automations.ports'
import {
  JobName,
  JobScope,
  JobTrigger,
  findJobDefinition,
} from '../src/modules/automations/domain/job-catalog'
import {
  IndexSourcePort,
  IndexSourceUnavailableError,
} from '../src/platform/index-source/index-source.port'
import { RequestContext } from '../src/shared/context/request-context'
import {
  addDays,
  addMonths,
  nextPeriod,
  periodOf,
  previousPeriod,
  todayIso,
} from '../src/shared/dates/calendar-date'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { loginAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'
import { waitFor } from './utils/wait-for'

const today = todayIso()
const cur = periodOf(today)
const prev1 = previousPeriod(cur)
const prev2 = previousPeriod(prev1)
const next = nextPeriod(cur)
const day = (n: number, period = cur) =>
  `${period}-${String(n).padStart(2, '0')}`

/** Una fuente de índices que el test controla: no sale a internet. */
const fakeSource = {
  provider: 'bcra-indec',
  supports: () => true,
  fetch: jest.fn(),
}

/** Automatizaciones (Fase 13): jobs, scheduler, historial, avisos internos e índices. */
describe('Automatizaciones (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string }
  let tenantB: { id: string }
  let adminToken: string
  let employeeToken: string
  let adminBToken: string
  let refs: { tolosa: string; casa: string; luz: string }

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

  let counter = 0
  const nextId = () => String(60_000_000 + ++counter)

  const createOwner = async (): Promise<string> => {
    const response = await api(adminToken)
      .post('/owners')
      .send({
        firstName: 'Juan',
        lastName: 'Pérez',
        nationalId: nextId(),
        email: 'juan@propietario.com',
        bankAccount: { cbu: '0110599552000000123456' },
      })
      .expect(201)
    return response.body.data.id
  }

  /** Un contrato activo de 100.000 ARS desde el 1° de hace dos meses. */
  const createContract = async (overrides: Record<string, unknown> = {}) => {
    const ownerId = await createOwner()
    const property = await api(adminToken)
      .post('/properties')
      .send({
        address: `Calle ${++counter}`,
        locationId: refs.tolosa,
        propertyTypeId: refs.casa,
        ownerId,
      })
      .expect(201)
    const renter = await api(adminToken)
      .post('/renters')
      .send({
        firstName: 'Iván',
        lastName: 'López',
        nationalId: nextId(),
        email: 'ivan@inquilino.com',
        phone: '1155550000',
      })
      .expect(201)
    const response = await api(adminToken)
      .post('/contracts')
      .send({
        propertyId: property.body.data.id,
        renterId: renter.body.data.id,
        startDate: day(1, prev2),
        endDate: addDays(addMonths(today, 22), -1),
        initialRent: '100000',
        currency: 'ARS',
        rentUpdateType: 'FIXED',
        rentUpdateFrequency: 'QUARTERLY',
        deposit: '100000',
        hasSurety: false,
        ...overrides,
      })
      .expect(201)
    return {
      id: response.body.data.id as string,
      propertyId: property.body.data.id as string,
      ownerId,
    }
  }

  /** Corre un job con una fecha elegida, como lo haría el consumidor de la cola. */
  const runJob = async (
    job: JobName,
    options: {
      today: string
      tenantId?: string
      manual?: boolean
      period?: string
    },
  ) => {
    const definition = findJobDefinition(job)!
    const tenantId = options.tenantId ?? tenantA.id
    const execution = await app.get(JobExecutionRepository).create({
      job,
      tenantId: definition.scope === JobScope.GLOBAL ? null : tenantId,
      scheduledFor: options.today,
      triggeredBy: options.manual ? JobTrigger.MANUAL : JobTrigger.SCHEDULE,
      triggeredByUserId: null,
    })
    return RequestContext.run({ correlationId: 'test' }, () =>
      RequestContext.runInTenant(tenantId, () =>
        app.get(JobRunner).execute(
          {
            job,
            executionId: execution.id,
            scheduledFor: options.today,
            period: options.period ?? null,
            manual: options.manual ?? false,
          },
          tenantId,
        ),
      ),
    )
  }

  // Desde la Fase 14 el aviso se encola en notification_log y sale por la cola de
  // entrega: lo que verifican estos tests es lo que el job le pidió a
  // NotificationsService. Se reconstruye desde las filas, juntando los mails por
  // persona del personal (sufijo :u:<usuario>) en un único aviso.
  const sentOf = async (type: string) => {
    const rows = await prisma.notificationLog.findMany({
      where: { type, status: { not: 'SKIPPED' } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    const seen = new Set<string>()
    return rows
      .filter((row) => {
        const base = row.dedupeKey.replace(/:u:.*$/, '')
        if (seen.has(base)) return false
        seen.add(base)
        return true
      })
      .map((row) => {
        const { channels, phone, ...data } = row.payload as Record<
          string,
          unknown
        >
        return {
          type: row.type,
          recipient: {
            kind: row.recipientKind as string,
            email: row.recipientEmail,
            phone,
          },
          entity: row.entityType
            ? { type: row.entityType, id: row.entityId }
            : undefined,
          dedupeKey: row.dedupeKey,
          channels,
          data,
        }
      })
  }

  const installmentsOf = async (contractId: string) =>
    (
      await api(adminToken)
        .get(`/billing/installments?contractId=${contractId}`)
        .expect(200)
    ).body.data.data as {
      id: string
      period: string
      baseAmount: string
    }[]

  const alerts = async (token = adminToken, query = '') =>
    (await api(token).get(`/automations/alerts${query}`).expect(200)).body.data
      .data as {
      id: string
      type: string
      title: string
      body: string
      link: string | null
      readAt: string | null
    }[]

  const currentRent = async (contractId: string) =>
    (await api(adminToken).get(`/contracts/${contractId}`).expect(200)).body
      .data.currentRent as string

  beforeAll(async () => {
    await prisma.$connect()
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IndexSourcePort)
      .useValue(fakeSource)
      .compile()
    app = moduleRef.createNestApplication<NestExpressApplication>()
    configureApp(app as NestExpressApplication)
    await app.init()
  })

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await resetDatabase(prisma)
    fakeSource.fetch.mockReset()
    fakeSource.fetch.mockResolvedValue({ source: 'bcra', values: [] })

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
    refs = {
      tolosa: (
        await prisma.location.findFirstOrThrow({
          where: { tenantId: tenantA.id, name: 'Tolosa' },
        })
      ).id,
      casa: (
        await prisma.propertyType.findFirstOrThrow({
          where: { tenantId: tenantA.id, name: 'Casa' },
        })
      ).id,
      luz: (
        await prisma.serviceType.findFirstOrThrow({
          where: { tenantId: tenantA.id, name: 'Luz' },
        })
      ).id,
    }
  })

  describe('catálogo, permisos y corrida manual', () => {
    it('lista los 12 jobs con su cron legible; sólo el admin; el empleado lee los avisos', async () => {
      const response = await api(adminToken)
        .get('/automations/jobs')
        .expect(200)
      const jobs = response.body.data as {
        name: string
        cronLabel: string
        scope: string
        lastExecution: unknown
        nextRunAt: string | null
      }[]
      expect(jobs).toHaveLength(12)
      expect(
        jobs.find((j) => j.name === 'billing.arrears-notice'),
      ).toMatchObject({
        cronLabel: 'todos los días a las 09:10',
        scope: 'TENANT',
        lastExecution: null,
        // Los tests corren con AUTOMATIONS_ENABLED=false.
        nextRunAt: null,
      })
      expect(jobs.find((j) => j.name === 'indices.fetch')).toMatchObject({
        cronLabel: 'todos los días a las 06:00 y 12:00',
        scope: 'GLOBAL',
      })

      await api(employeeToken).get('/automations/jobs').expect(403)
      await api(employeeToken).get('/automations/executions').expect(403)
      await api(employeeToken)
        .post('/automations/jobs/contracts.finish-expired/run')
        .send({})
        .expect(403)
      await api(employeeToken).get('/automations/alerts').expect(200)
    })

    it('POST /run encola la ejecución (202), la corre la cola y queda en el historial con quién la pidió', async () => {
      const response = await api(adminToken)
        .post('/automations/jobs/contracts.finish-expired/run')
        .send({})
        .expect(202)
      const { executionId } = response.body.data
      expect(executionId).toEqual(expect.any(String))

      let execution: Record<string, unknown> | undefined
      await waitFor(async () => {
        const list = await api(adminToken)
          .get('/automations/executions?job=contracts.finish-expired')
          .expect(200)
        execution = list.body.data.data.find(
          (e: { id: string }) => e.id === executionId,
        )
        return execution !== undefined && execution.status !== 'RUNNING'
      })
      expect(execution).toMatchObject({
        job: 'contracts.finish-expired',
        tenantId: tenantA.id,
        status: 'SUCCEEDED',
        affected: 0,
        triggeredBy: 'MANUAL',
        triggeredByUser: { fullName: 'admin@a.com' },
      })

      const jobs = await api(adminToken).get('/automations/jobs').expect(200)
      expect(
        jobs.body.data.find(
          (j: { name: string }) => j.name === 'contracts.finish-expired',
        ).lastExecution.id,
      ).toBe(executionId)
    })

    it('valida el job y el período', async () => {
      const missing = await api(adminToken)
        .post('/automations/jobs/no.existe/run')
        .send({})
        .expect(404)
      expect(missing.body.code).toBe('AUTOMATION_JOB_NOT_FOUND')
      await api(adminToken)
        .post('/automations/jobs/installments.generate/run')
        .send({ period: '2026-13' })
        .expect(400)
    })

    it('cada inmobiliaria ve sólo lo suyo y lo global', async () => {
      await runJob(JobName.CONTRACTS_FINISH_EXPIRED, { today })
      await runJob(JobName.INDICES_FETCH, { today })

      const own = await api(adminToken)
        .get('/automations/executions')
        .expect(200)
      expect(
        own.body.data.data.map((e: { job: string }) => e.job).sort(),
      ).toEqual(['contracts.finish-expired', 'indices.fetch'])
      const other = await api(adminBToken)
        .get('/automations/executions')
        .expect(200)
      expect(other.body.data.data.map((e: { job: string }) => e.job)).toEqual([
        'indices.fetch',
      ])
      const filtered = await api(adminToken)
        .get('/automations/executions?status=FAILED')
        .expect(200)
      expect(filtered.body.data.pagination.total).toBe(0)
    })
  })

  describe('scheduler', () => {
    it('encola lo que falta hoy, no lo repite, y la cola lo ejecuta todo sin fallas', async () => {
      // 10:00 hora de Buenos Aires: ya pasaron todos los jobs por inmobiliaria
      // y la primera corrida de índices.
      const at = new Date('2026-10-31T13:00:00Z')
      const scheduler = app.get(JobScheduler)

      const first = await scheduler.enqueueDue(at)
      expect(first).toBe(2 * 10 + 1)
      expect(await scheduler.enqueueDue(at)).toBe(0)

      const executions = app.get(JobExecutionRepository)
      await waitFor(async () => {
        const [rows] = await executions.list(
          tenantA.id,
          {},
          { skip: 0, take: 100 },
        )
        return rows.length >= 11 && rows.every((r) => r.status !== 'RUNNING')
      })
      const [rowsA] = await executions.list(
        tenantA.id,
        {},
        { skip: 0, take: 100 },
      )
      const [rowsB] = await executions.list(
        tenantB.id,
        {},
        { skip: 0, take: 100 },
      )
      expect(rowsA.filter((r) => r.tenantId === tenantA.id)).toHaveLength(10)
      expect(rowsB.filter((r) => r.tenantId === tenantB.id)).toHaveLength(10)
      expect([...rowsA, ...rowsB].filter((r) => r.status === 'FAILED')).toEqual(
        [],
      )

      // A las 12:10 corre la segunda de índices; los demás ya están.
      expect(await scheduler.enqueueDue(new Date('2026-10-31T15:10:00Z'))).toBe(
        1,
      )
    })

    it('antes de las 00:10 no hay nada que encolar', async () => {
      expect(
        await app
          .get(JobScheduler)
          .enqueueDue(new Date('2026-10-31T03:05:00Z')),
      ).toBe(0)
    })
  })

  describe('generar cuotas', () => {
    it('genera el mes en curso y, desde el día de generación, el siguiente; es idempotente', async () => {
      const contract = await createContract()

      const early = await runJob(JobName.INSTALLMENTS_GENERATE, {
        today: day(5),
      })
      expect(early).toMatchObject({ status: 'SUCCEEDED', affected: 1 })
      expect((await installmentsOf(contract.id)).map((i) => i.period)).toEqual([
        cur,
      ])

      const late = await runJob(JobName.INSTALLMENTS_GENERATE, {
        today: day(28),
      })
      // El mes en curso ya estaba; se crea el siguiente.
      expect(late.affected).toBe(1)
      expect(late.summary).toContain('1 cuotas creadas, 1 ya existían')

      const again = await runJob(JobName.INSTALLMENTS_GENERATE, {
        today: day(28),
      })
      expect(again.affected).toBe(0)
      expect(
        (await installmentsOf(contract.id)).map((i) => i.period).sort(),
      ).toEqual([cur, next])
    })

    it('un servidor apagado el 28 las genera el 29 (recupera, no pregunta si es el día)', async () => {
      const contract = await createContract()

      const result = await runJob(JobName.INSTALLMENTS_GENERATE, {
        today: day(29),
      })

      expect(result.affected).toBe(2)
      expect(
        (await installmentsOf(contract.id)).map((i) => i.period).sort(),
      ).toEqual([cur, next])
    })

    it('a mano con un mes genera sólo ese mes', async () => {
      const contract = await createContract()

      await runJob(JobName.INSTALLMENTS_GENERATE, {
        today: day(2),
        manual: true,
        period: next,
      })

      expect((await installmentsOf(contract.id)).map((i) => i.period)).toEqual([
        next,
      ])
    })
  })

  describe('contratos vencidos', () => {
    it('finaliza los que ya terminaron y es idempotente', async () => {
      const contract = await createContract()
      const afterEnd = addMonths(today, 30)

      const result = await runJob(JobName.CONTRACTS_FINISH_EXPIRED, {
        today: afterEnd,
      })

      expect(result).toMatchObject({ status: 'SUCCEEDED', affected: 1 })
      const detail = await api(adminToken)
        .get(`/contracts/${contract.id}`)
        .expect(200)
      expect(detail.body.data.status).toBe('FINISHED')
      expect(
        (await runJob(JobName.CONTRACTS_FINISH_EXPIRED, { today: afterEnd }))
          .affected,
      ).toBe(0)
    })
  })

  describe('aumentos de alquiler', () => {
    it('aplica los fijos con porcentaje, corrige las cuotas pendientes y avisa las que ya tienen pagos', async () => {
      const contract = await createContract({
        rentUpdateType: 'FIXED',
        rentUpdateFrequency: 'MONTHLY',
        fixedIncreasePercentage: '10',
      })
      // Dos cuotas generadas con el alquiler de entonces (100.000).
      await runJob(JobName.INSTALLMENTS_GENERATE, { today: day(28) })
      const [curInstallment, nextInstallment] = (
        await installmentsOf(contract.id)
      ).sort((a, b) => a.period.localeCompare(b.period))
      expect(curInstallment.period).toBe(cur)
      expect(nextInstallment.period).toBe(next)
      // La del mes en curso ya recibió un pago parcial.
      await api(adminToken)
        .post(`/billing/installments/${curInstallment.id}/payments`)
        .field('paidCurrency', 'ARS')
        .field('method', 'TRANSFER')
        .field('paidAt', day(1))
        .field('amount', '1000')
        .expect(201)

      const result = await runJob(JobName.RENT_UPDATES_APPLY, {
        today: day(28),
      })

      // Los aumentos de `prev1-01` y `cur-01`: 100.000 → 110.000 → 121.000.
      expect(result.affected).toBe(2)
      expect(await currentRent(contract.id)).toBe('121000.00')
      const detail = await api(adminToken)
        .get(`/contracts/${contract.id}`)
        .expect(200)
      expect(detail.body.data.rentUpdates[0]).toMatchObject({
        source: 'MANUAL',
        fixedPercentage: '10.00',
        appliedById: null,
      })

      // Cobros recibe los eventos por la cola y corrige la base.
      await waitFor(async () => {
        const rows = await installmentsOf(contract.id)
        return rows.find((i) => i.period === next)?.baseAmount === '121000.00'
      })
      const rows = await installmentsOf(contract.id)
      // La que tiene un pago no se toca: se avisa.
      expect(rows.find((i) => i.period === cur)?.baseAmount).toBe('100000.00')
      await waitFor(async () =>
        (await alerts()).some((a) => a.type === 'INSTALLMENT_BASE_OUTDATED'),
      )
      const outdated = (await alerts()).find(
        (a) => a.type === 'INSTALLMENT_BASE_OUTDATED',
      )!
      expect(outdated.link).toBe(`/contratos/${contract.id}`)

      // Idempotente: ya está al día.
      expect(
        (await runJob(JobName.RENT_UPDATES_APPLY, { today: day(28) })).affected,
      ).toBe(0)
    })

    it('un aumento manual desde la API también corrige las cuotas', async () => {
      const contract = await createContract({
        rentUpdateType: 'OTHER',
        rentUpdateFrequency: 'MONTHLY',
      })
      await runJob(JobName.INSTALLMENTS_GENERATE, { today: day(28) })

      await api(adminToken)
        .post(`/contracts/${contract.id}/rent-updates`)
        .send({ newRent: '105000' })
        .expect(201)

      // Falta aplicar el del mes en curso; con uno solo, las cuotas ≥ prev1 cambian.
      await waitFor(async () =>
        (await installmentsOf(contract.id)).every(
          (i) => i.baseAmount === '105000.00',
        ),
      )
    })

    it('con ICL sin índice avisa una sola vez; con el índice cargado lo aplica', async () => {
      const contract = await createContract({
        rentUpdateType: 'ICL',
        rentUpdateFrequency: 'MONTHLY',
      })

      const first = await runJob(JobName.RENT_UPDATES_APPLY, { today: day(5) })

      expect(first.affected).toBe(0)
      expect(first.summary).toContain('requieren carga manual')
      const pending = await alerts(adminToken, '?unreadOnly=true')
      expect(pending).toHaveLength(1)
      expect(pending[0]).toMatchObject({
        type: 'RENT_UPDATE_PENDING',
        link: `/contratos/${contract.id}`,
      })
      expect(pending[0].body).toContain(`índice ICL de ${prev2}`)

      await runJob(JobName.RENT_UPDATES_APPLY, { today: day(6) })
      expect(await alerts()).toHaveLength(1)

      for (const [period, value] of [
        [prev2, '100'],
        [prev1, '110'],
        [cur, '121'],
      ]) {
        await api(adminToken)
          .post('/indices')
          .send({ indexType: 'ICL', period, value })
          .expect(201)
      }
      const applied = await runJob(JobName.RENT_UPDATES_APPLY, {
        today: day(7),
      })

      expect(applied.affected).toBe(2)
      expect(await currentRent(contract.id)).toBe('121000.00')
    })

    it('un contrato de aumento manual (OTHER) pide carga manual', async () => {
      await createContract({
        rentUpdateType: 'OTHER',
        rentUpdateFrequency: 'MONTHLY',
      })

      const result = await runJob(JobName.RENT_UPDATES_APPLY, { today: day(5) })

      expect(result.affected).toBe(0)
      expect((await alerts())[0].body).toContain('la actualización es manual')
    })
  })

  describe('índices', () => {
    it('si la fuente falla avisa a quien usa el índice y lo muestra en /indices/status; después carga sin pisar', async () => {
      await createContract({
        rentUpdateType: 'ICL',
        rentUpdateFrequency: 'MONTHLY',
      })
      fakeSource.fetch.mockRejectedValue(
        new IndexSourceUnavailableError('bcra', 'respondió HTTP 503'),
      )

      const failed = await runJob(JobName.INDICES_FETCH, { today })

      expect(failed.status).toBe('FAILED')
      const alert = (await alerts()).find(
        (a) => a.type === 'INDEX_FETCH_FAILED',
      )
      expect(alert?.body).toContain('respondió HTTP 503')
      // La inmobiliaria B no tiene contratos ICL/IPC: nada que avisar.
      expect(await alerts(adminBToken)).toEqual([])

      const status = await api(adminToken).get('/indices/status').expect(200)
      expect(status.body.data).toEqual([
        expect.objectContaining({
          indexType: 'ICL',
          latestPeriod: null,
          lastAttemptStatus: 'FAILED',
          lastAttemptError: 'bcra: respondió HTTP 503',
          provider: 'bcra-indec',
        }),
        expect.objectContaining({
          indexType: 'IPC',
          lastAttemptStatus: 'FAILED',
        }),
      ])

      // La fuente vuelve: trae los tres meses.
      fakeSource.fetch.mockImplementation(async (_type, periods: string[]) => ({
        source: 'bcra',
        values: periods.map((period) => ({ period, value: '12.5' })),
      }))
      const ok = await runJob(JobName.INDICES_FETCH, { today })
      expect(ok).toMatchObject({ status: 'SUCCEEDED', affected: 6 })

      const after = await api(adminToken).get('/indices/status').expect(200)
      expect(after.body.data[0]).toMatchObject({
        indexType: 'ICL',
        latestPeriod: periodOf(addMonths(today, -1)),
        latestValue: '12.500000',
        source: 'bcra',
        lastAttemptStatus: 'SUCCEEDED',
      })

      // Un mes cargado no se pisa: con otro valor sigue el primero.
      fakeSource.fetch.mockClear()
      await runJob(JobName.INDICES_FETCH, { today })
      expect(fakeSource.fetch).not.toHaveBeenCalled()
      const listed = await api(adminToken).get('/indices?type=ICL').expect(200)
      expect(listed.body.data[0]).toMatchObject({
        value: '12.500000',
        source: 'bcra',
      })
    })
  })

  describe('recordatorio, mora y aseguradora', () => {
    it('recordatorio: desde el día configurado y hasta que termina la gracia, una sola vez por cuota', async () => {
      await createContract()
      await runJob(JobName.INSTALLMENTS_GENERATE, { today: day(2) })
      await prisma.tenant.update({
        where: { id: tenantA.id },
        data: { paymentReminderDay: 5 },
      })

      const early = await runJob(JobName.PAYMENT_REMINDER, { today: day(3) })
      expect(early.status).toBe('SKIPPED')
      expect(await sentOf('PAYMENT_REMINDER')).toHaveLength(0)

      // El servidor estuvo caído el día 5: sale el 6.
      const sent = await runJob(JobName.PAYMENT_REMINDER, { today: day(6) })
      expect(sent).toMatchObject({ status: 'SUCCEEDED', affected: 1 })
      expect(await sentOf('PAYMENT_REMINDER')).toHaveLength(1)
      expect((await sentOf('PAYMENT_REMINDER'))[0]).toMatchObject({
        recipient: { kind: 'RENTER', email: 'ivan@inquilino.com' },
        channels: ['EMAIL', 'WHATSAPP_LINK'],
        data: { period: cur, amount: '100000.00', currency: 'ARS' },
      })

      const again = await runJob(JobName.PAYMENT_REMINDER, { today: day(7) })
      expect(again.affected).toBe(0)
      expect(await sentOf('PAYMENT_REMINDER')).toHaveLength(1)

      // Pasada la gracia ya no es un recordatorio.
      const late = await runJob(JobName.PAYMENT_REMINDER, { today: day(12) })
      expect(late.status).toBe('SKIPPED')
    })

    it('no recuerda una cuota que ya recibió un pago', async () => {
      const contract = await createContract()
      await runJob(JobName.INSTALLMENTS_GENERATE, { today: day(2) })
      const [installment] = await installmentsOf(contract.id)
      await api(adminToken)
        .post(`/billing/installments/${installment.id}/payments`)
        .field('paidCurrency', 'ARS')
        .field('method', 'TRANSFER')
        .field('paidAt', day(1))
        .field('amount', '1000')
        .expect(201)

      const result = await runJob(JobName.PAYMENT_REMINDER, { today: day(2) })

      expect(result.status).toBe('SKIPPED')
      expect(await sentOf('PAYMENT_REMINDER')).toHaveLength(0)
    })

    it('mora: una vez por cuota, el primer día después de la gracia, al inquilino y a la inmobiliaria', async () => {
      await createContract()
      await runJob(JobName.INSTALLMENTS_GENERATE, { today: day(2) })

      const none = await runJob(JobName.ARREARS_NOTICE, { today: day(10) })
      expect(none.status).toBe('SKIPPED')

      // Caído el 11: sale el 12.
      const sent = await runJob(JobName.ARREARS_NOTICE, { today: day(12) })
      expect(sent).toMatchObject({ status: 'SUCCEEDED', affected: 1 })
      const notices = await sentOf('ARREARS_NOTICE')
      expect(notices.map((n) => n.recipient.kind).sort()).toEqual([
        'RENTER',
        'TENANT_STAFF',
      ])
      expect(notices[0].data).toMatchObject({
        rentBalance: '100000.00',
        daysOverdue: 2,
        lateFeeBalance: '10000.00',
        totalDue: '110000.00',
      })

      const again = await runJob(JobName.ARREARS_NOTICE, { today: day(13) })
      expect(again.affected).toBe(0)
      expect(await sentOf('ARREARS_NOTICE')).toHaveLength(2)
    })

    it('aseguradora: desde el día siguiente al recordatorio, para contratos con caución impagos, una vez por cuota', async () => {
      await createContract({
        hasSurety: true,
        insurerName: 'Finaer',
        insurerAlertEmail: 'alertas@finaer.com',
        policyNumber: 'POL-1',
        policyExpiresAt: addDays(today, 300),
      })
      await createContract()
      await runJob(JobName.INSTALLMENTS_GENERATE, { today: day(1) })

      const sameDay = await runJob(JobName.INSURER_ALERT, { today: day(1) })
      expect(sameDay.status).toBe('SKIPPED')

      const sent = await runJob(JobName.INSURER_ALERT, { today: day(2) })
      expect(sent).toMatchObject({ status: 'SUCCEEDED', affected: 1 })
      const [alert] = await sentOf('INSURER_ALERT')
      expect(alert).toMatchObject({
        recipient: { kind: 'INSURER', email: 'alertas@finaer.com' },
        data: {
          insurerName: 'Finaer',
          policyNumber: 'POL-1',
          renterName: 'Iván López',
          period: cur,
          amount: '100000.00',
        },
      })
      expect(
        (await runJob(JobName.INSURER_ALERT, { today: day(3) })).affected,
      ).toBe(0)
      expect(await sentOf('INSURER_ALERT')).toHaveLength(1)
    })
  })

  describe('vencimientos', () => {
    it('contratos por vencer: al propietario y a la inmobiliaria, una sola vez', async () => {
      const contract = await createContract({ endDate: addDays(today, 20) })

      const first = await runJob(JobName.CONTRACT_EXPIRY_NOTICE, { today })

      expect(first.affected).toBe(1)
      const notices = await sentOf('CONTRACT_EXPIRING')
      expect(notices.map((n) => n.recipient.kind).sort()).toEqual([
        'OWNER',
        'TENANT_STAFF',
      ])
      expect(notices[0].entity).toEqual({ type: 'CONTRACT', id: contract.id })
      expect(
        notices.find((n) => n.recipient.kind === 'OWNER')?.recipient.email,
      ).toBe('juan@propietario.com')

      const later = await runJob(JobName.CONTRACT_EXPIRY_NOTICE, {
        today: addDays(today, 5),
      })
      expect(later.affected).toBe(0)
      expect(await sentOf('CONTRACT_EXPIRING')).toHaveLength(2)
    })

    it('un contrato que vence dentro de más días que el aviso no se avisa', async () => {
      await createContract({ endDate: addDays(today, 200) })

      const result = await runJob(JobName.CONTRACT_EXPIRY_NOTICE, { today })

      expect(result.status).toBe('SKIPPED')
    })

    it('pólizas: avisa la que vence en 30 días y, aparte, cuando ya venció', async () => {
      await createContract({
        hasSurety: true,
        insurerName: 'Finaer',
        insurerAlertEmail: 'alertas@finaer.com',
        policyNumber: 'POL-1',
        policyExpiresAt: addDays(today, 10),
      })

      expect(
        (await runJob(JobName.POLICY_EXPIRY_NOTICE, { today })).affected,
      ).toBe(1)
      expect(await sentOf('POLICY_EXPIRING')).toHaveLength(1)
      expect(
        (
          await runJob(JobName.POLICY_EXPIRY_NOTICE, {
            today: addDays(today, 3),
          })
        ).affected,
      ).toBe(0)

      const expired = await runJob(JobName.POLICY_EXPIRY_NOTICE, {
        today: addDays(today, 15),
      })
      expect(expired.affected).toBe(1)
      expect(await sentOf('POLICY_EXPIRED')).toHaveLength(1)
    })

    it('servicios vencidos: desde el 5° día, al inquilino y a la inmobiliaria, una vez por vencimiento', async () => {
      const contract = await createContract()
      // Uno vinculado al contrato, uno sin vincular (se usa el contrato activo
      // de la propiedad) y uno que todavía no llegó al 5° día.
      for (const [dueDate, linked] of [
        [addDays(today, -7), true],
        [addDays(today, -9), false],
        [addDays(today, -3), true],
      ] as const) {
        await api(adminToken)
          .post(`/properties/${contract.propertyId}/services`)
          .send({
            serviceTypeId: refs.luz,
            paidBy: 'RENTER',
            currency: 'ARS',
            hasDueDate: true,
            dueDate,
            hasIncrease: false,
            managedByAgency: true,
            ...(linked ? { contractId: contract.id } : {}),
          })
          .expect(201)
      }

      const result = await runJob(JobName.SERVICE_OVERDUE_NOTICE, { today })

      expect(result).toMatchObject({ status: 'SUCCEEDED', affected: 2 })
      const notices = await sentOf('SERVICE_OVERDUE')
      expect(notices.map((n) => n.recipient.kind).sort()).toEqual([
        'RENTER',
        'RENTER',
        'TENANT_STAFF',
        'TENANT_STAFF',
      ])
      expect(notices[0].data).toMatchObject({ serviceName: 'Luz' })
      expect(
        (await runJob(JobName.SERVICE_OVERDUE_NOTICE, { today })).affected,
      ).toBe(0)
    })
  })

  describe('consolidados', () => {
    it('avisa los propietarios con liquidaciones sin consolidar desde el día del informe, una vez por mes', async () => {
      const contract = await createContract({ lateFeeGraceDays: 90 })
      await runJob(JobName.INSTALLMENTS_GENERATE, { today: day(2) })
      const [installment] = await installmentsOf(contract.id)
      await api(adminToken)
        .post(`/billing/installments/${installment.id}/payments`)
        .field('paidCurrency', 'ARS')
        .field('method', 'TRANSFER')
        .field('paidAt', day(1))
        .field('amount', '100000')
        .expect(201)
      let settlementId = ''
      await waitFor(async () => {
        const list = await api(adminToken)
          .get(`/settlements?contractId=${contract.id}`)
          .expect(200)
        settlementId = list.body.data.data[0]?.id ?? ''
        return settlementId !== ''
      })
      await api(adminToken)
        .post(`/settlements/${settlementId}/confirm`)
        .expect(200)

      // La liquidación es del mes en curso; el informe se revisa el mes siguiente.
      const early = await runJob(JobName.STATEMENT_REMINDER, {
        today: day(5, next),
      })
      expect(early.status).toBe('SKIPPED')

      const sent = await runJob(JobName.STATEMENT_REMINDER, {
        today: day(10, next),
      })
      expect(sent).toMatchObject({ status: 'SUCCEEDED', affected: 1 })
      const pending = (await alerts()).filter(
        (a) => a.type === 'STATEMENT_PENDING',
      )
      expect(pending).toHaveLength(1)
      expect(pending[0].body).toContain('Juan Pérez')
      expect(pending[0].body).toContain(cur)

      expect(
        (await runJob(JobName.STATEMENT_REMINDER, { today: day(11, next) }))
          .affected,
      ).toBe(0)
    })
  })

  describe('avisos internos', () => {
    it('se marcan leídos de a uno o todos juntos, y son de cada inmobiliaria', async () => {
      await createContract({
        rentUpdateType: 'OTHER',
        rentUpdateFrequency: 'MONTHLY',
      })
      await createContract({
        rentUpdateType: 'OTHER',
        rentUpdateFrequency: 'MONTHLY',
      })
      await runJob(JobName.RENT_UPDATES_APPLY, { today: day(5) })

      const unread = await alerts(employeeToken, '?unreadOnly=true')
      expect(unread).toHaveLength(2)
      expect(await alerts(adminBToken)).toEqual([])

      const read = await api(employeeToken)
        .patch(`/automations/alerts/${unread[0].id}/read`)
        .expect(200)
      expect(read.body.data.readAt).not.toBeNull()
      expect(await alerts(employeeToken, '?unreadOnly=true')).toHaveLength(1)
      expect(await alerts(employeeToken)).toHaveLength(2)

      // Otra inmobiliaria no puede tocarlo.
      await api(adminBToken)
        .patch(`/automations/alerts/${unread[1].id}/read`)
        .expect(404)

      const all = await api(employeeToken)
        .post('/automations/alerts/read-all')
        .expect(200)
      expect(all.body.data).toEqual({ updated: 1 })
      expect(await alerts(employeeToken, '?unreadOnly=true')).toEqual([])
    })
  })
})
