import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import request from 'supertest'

import { seedBaseMasterData } from '../prisma/lib/master-data-seed'
import {
  addDays,
  addMonths,
  lastDayOfPeriod,
  nextPeriod,
  periodOf,
  todayIso,
} from '../src/shared/dates/calendar-date'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

const today = todayIso()
const period = periodOf(today)

/** Cobros y punitorios (rediseño Fase 11): generación, saldos, pagos, créditos, aislamiento. */
describe('Cobros (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string }
  let tenantB: { id: string }
  let adminToken: string
  let employeeToken: string
  let adminBToken: string
  let refs: { tolosa: string; casa: string }
  let refsB: { tolosa: string; casa: string }

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
  const nextId = () => String(40_000_000 + ++counter)

  const createOwner = async (token = adminToken): Promise<string> => {
    const response = await api(token)
      .post('/owners')
      .send({ firstName: 'Juan', lastName: 'Pérez', nationalId: nextId() })
      .expect(201)
    return response.body.data.id
  }

  const createProperty = async (
    token = adminToken,
    master = refs,
  ): Promise<string> => {
    const ownerId = await createOwner(token)
    const response = await api(token)
      .post('/properties')
      .send({
        address: `Calle ${++counter}`,
        locationId: master.tolosa,
        propertyTypeId: master.casa,
        ownerId,
      })
      .expect(201)
    return response.body.data.id
  }

  const createRenter = async (token = adminToken): Promise<string> => {
    const response = await api(token)
      .post('/renters')
      .send({ firstName: 'Iván', lastName: 'López', nationalId: nextId() })
      .expect(201)
    return response.body.data.id
  }

  /**
   * Una propiedad con su contrato activo: 100.000, punitorio 5 % diario
   * (el del tenant) y gracia 0 por defecto, así la cuota del mes en curso
   * ya está vencida desde el día 1 y los días se cuentan sin depender de
   * qué día es hoy.
   */
  const createContract = async (
    overrides: Record<string, unknown> = {},
    token = adminToken,
    master = refs,
  ) => {
    const propertyId = await createProperty(token, master)
    const renterId = await createRenter(token)
    const response = await api(token)
      .post('/contracts')
      .send({
        propertyId,
        renterId,
        startDate: addMonths(today, -2),
        endDate: addDays(addMonths(today, 22), -1),
        initialRent: '100000',
        currency: 'ARS',
        rentUpdateType: 'FIXED',
        rentUpdateFrequency: 'QUARTERLY',
        deposit: '100000',
        hasSurety: false,
        lateFeeGraceDays: 0,
        ...overrides,
      })
      .expect(201)
    return {
      id: response.body.data.id as string,
      propertyId,
      renterId,
      ownerId: response.body.data.owner.id as string,
    }
  }

  const generate = async (forPeriod: string = period, token = adminToken) => {
    const response = await api(token)
      .post('/billing/installments/generate')
      .send({ period: forPeriod })
      .expect(200)
    return response.body.data as {
      period: string
      contracts: number
      created: number
      skipped: number
    }
  }

  /** La cuota de un contrato para un mes, por el listado. */
  const installmentOf = async (contractId: string, forPeriod = period) => {
    const response = await api(adminToken)
      .get(`/billing/installments?contractId=${contractId}&period=${forPeriod}`)
      .expect(200)
    return response.body.data.data[0]
  }

  const detail = async (id: string, token = adminToken) =>
    (await api(token).get(`/billing/installments/${id}`).expect(200)).body.data

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
    await seedBaseMasterData(prisma, tenantB.id, { withSampleCities: true })
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

    const master = async (tenantId: string) => ({
      tolosa: (
        await prisma.location.findFirstOrThrow({
          where: { tenantId, name: 'Tolosa' },
        })
      ).id,
      casa: (
        await prisma.propertyType.findFirstOrThrow({
          where: { tenantId, name: 'Casa' },
        })
      ).id,
    })
    refs = await master(tenantA.id)
    refsB = await master(tenantB.id)
  })

  describe('generación de cuotas (spec 3.1, regla 1)', () => {
    it('una cuota por contrato activo que cubre el mes, con el snapshot de los términos; correrlo dos veces no duplica', async () => {
      const contract = await createContract({
        currency: 'USD',
        initialRent: '1000',
        collectionMode: 'OWNER_DIRECT',
        feeMode: 'OWNER_PAYS',
        feeAmount: '50',
        lateFeePercentage: '2.5',
        lateFeeGraceDays: 10,
      })
      // Un contrato que empieza el mes que viene no entra en este mes (A-7:
      // el que arranca a mitad de mes, sí).
      await createContract({
        startDate: addDays(lastDayOfPeriod(period), 1),
        endDate: addMonths(today, 24),
      })
      const midMonth = await createContract({
        startDate: `${period}-15`,
        endDate: addMonths(today, 24),
      })

      const first = await generate(period, employeeToken)
      expect(first).toEqual({ period, contracts: 2, created: 2, skipped: 0 })
      const second = await generate()
      expect(second).toEqual({ period, contracts: 2, created: 0, skipped: 2 })

      const installment = await installmentOf(contract.id)
      expect(installment).toMatchObject({
        period,
        contract: { id: contract.id },
        property: { id: contract.propertyId },
        renter: { id: contract.renterId },
        owner: { id: contract.ownerId },
        currency: 'USD',
        baseAmount: '1000.00',
        graceEndDate: `${period}-10`,
        collectionMode: 'OWNER_DIRECT',
        feeMode: 'OWNER_PAYS',
        paidTotal: '0.00',
        rentBalance: '1000.00',
        paidAt: null,
      })
      const full = await detail(installment.id)
      expect(full).toMatchObject({
        lateFeePercentage: '2.50',
        lateFeeGraceDays: 10,
        feePercentage: '5.00',
        feeAmount: '50.00',
        feeOnBase: '50.00',
        feeOnCollected: '0.00',
        charges: [],
        payments: [],
        lateFeeAdjustments: [],
        creditsAvailable: '0.00',
      })
      expect(await installmentOf(midMonth.id)).toMatchObject({
        baseAmount: '100000.00',
      })

      // Cambiar los términos del contrato no toca la cuota ya generada,
      // pero sí la del mes siguiente (D-71).
      await api(adminToken)
        .post(`/contracts/${contract.id}/billing-terms`)
        .send({ lateFeeGraceDays: 3, collectionMode: 'AGENCY' })
        .expect(201)
      await generate(nextPeriod(period))
      expect(await installmentOf(contract.id)).toMatchObject({
        collectionMode: 'OWNER_DIRECT',
        graceEndDate: `${period}-10`,
      })
      expect(
        await installmentOf(contract.id, nextPeriod(period)),
      ).toMatchObject({
        collectionMode: 'AGENCY',
        graceEndDate: `${nextPeriod(period)}-03`,
      })

      const bad = await api(adminToken)
        .post('/billing/installments/generate')
        .send({ period: '2026-13' })
        .expect(400)
      expect(bad.body.code).toBe('INSTALLMENT_INVALID_PERIOD')
    })

    it('sin período genera el mes siguiente', async () => {
      await createContract()
      const response = await api(adminToken)
        .post('/billing/installments/generate')
        .send({})
        .expect(200)
      const result = response.body.data
      expect(result.period).toBe(nextPeriod(period))
      expect(result.created).toBe(1)
    })
  })

  describe('listado, resumen y desglose (spec 3.2, 3.4; D-71)', () => {
    it('el estado se calcula al leer: vencida con gracia pasada, pendiente dentro de la gracia; filtra por estado y modalidad', async () => {
      const overdue = await createContract()
      const pending = await createContract({
        lateFeeGraceDays: 31,
        collectionMode: 'OWNER_DIRECT',
      })
      await generate()

      const all = await api(adminToken)
        .get(`/billing/installments?period=${period}`)
        .expect(200)
      expect(all.body.data.pagination.total).toBe(2)

      const overdueList = await api(adminToken)
        .get(`/billing/installments?period=${period}&status=OVERDUE`)
        .expect(200)
      expect(overdueList.body.data.data).toHaveLength(1)
      expect(overdueList.body.data.data[0]).toMatchObject({
        contract: { id: overdue.id },
        status: 'OVERDUE',
        feeDays: Number(today.slice(8, 10)),
      })

      const pendingList = await api(adminToken)
        .get(`/billing/installments?period=${period}&status=PENDING`)
        .expect(200)
      expect(pendingList.body.data.data).toHaveLength(1)
      expect(pendingList.body.data.data[0]).toMatchObject({
        contract: { id: pending.id },
        status: 'PENDING',
        feeDays: 0,
        lateFeeAccrued: '0.00',
      })

      const byMode = await api(adminToken)
        .get(`/billing/installments?collectionMode=OWNER_DIRECT`)
        .expect(200)
      expect(
        byMode.body.data.data.map(
          (i: { contract: { id: string } }) => i.contract.id,
        ),
      ).toEqual([pending.id])

      const paidList = await api(adminToken)
        .get(`/billing/installments?period=${period}&status=PAID`)
        .expect(200)
      expect(paidList.body.data.data).toHaveLength(0)

      const summary = await api(adminToken)
        .get(`/billing/installments/summary?period=${period}`)
        .expect(200)
      expect(summary.body.data.period).toBe(period)
      expect(summary.body.data.byCurrency).toHaveLength(1)
      expect(summary.body.data.byCurrency[0]).toMatchObject({
        currency: 'ARS',
        total: 2,
        pending: 1,
        partial: 0,
        overdue: 1,
        paid: 0,
        baseTotal: '200000.00',
        collectedTotal: '0.00',
        feeAccruedOnBase: '10000.00',
        feeAccruedOnCollected: '0.00',
      })
    })

    it('el desglose a una fecha recalcula el punitorio sin cron: gracia 0, día 5 → 5 días, 25.000', async () => {
      const contract = await createContract()
      await generate()
      const { id } = await installmentOf(contract.id)

      const breakdown = await api(adminToken)
        .get(`/billing/installments/${id}/breakdown?asOf=${period}-05`)
        .expect(200)
      expect(breakdown.body.data).toMatchObject({
        installmentId: id,
        period,
        currency: 'ARS',
        asOf: `${period}-05`,
        baseAmount: '100000.00',
        graceEndDate: addDays(`${period}-01`, -1),
        feeDays: 5,
        lateFeePercentage: '5.00',
        lateFeeAccrued: '25000.00',
        lateFeeBalance: '25000.00',
        rentBalance: '100000.00',
        totalDue: '125000.00',
        creditAvailable: '0.00',
        totalDueAfterCredit: '125000.00',
      })
      expect(breakdown.body.data.days).toHaveLength(5)
      expect(breakdown.body.data.days[0]).toEqual({
        day: `${period}-01`,
        dayNumber: 1,
        outstandingBase: '100000.00',
        dailyPercentage: '5.00',
        amount: '5000.00',
      })

      // Antes de que empiece el punitorio, cero.
      const early = await api(adminToken)
        .get(
          `/billing/installments/${id}/breakdown?asOf=${addDays(`${period}-01`, -1)}`,
        )
        .expect(200)
      expect(early.body.data.lateFeeAccrued).toBe('0.00')

      await api(adminToken)
        .get(`/billing/installments/${id}/breakdown?asOf=2026-02-30`)
        .expect(400)
      await api(adminToken)
        .get(`/billing/installments/${UNKNOWN_ID}`)
        .expect(404)
    })

    it('la cuenta corriente del contrato arma totales, cuotas y movimientos con el depósito', async () => {
      const contract = await createContract({
        depositReturnMode: 'FOLLOWS_RENT',
      })
      await generate()
      const account = await api(adminToken)
        .get(`/contracts/${contract.id}/account`)
        .expect(200)
      const day = Number(today.slice(8, 10))
      const lateFee = (day * 5000).toFixed(2)
      expect(account.body.data).toMatchObject({
        contract: {
          id: contract.id,
          currency: 'ARS',
          collectionMode: 'AGENCY',
          feeMode: 'DEDUCTED',
          depositReturnMode: 'FOLLOWS_RENT',
        },
        totals: {
          accrued: '100000.00',
          chargesTotal: '0.00',
          lateFeeAccrued: lateFee,
          collected: '0.00',
          balance: (100000 + day * 5000).toFixed(2),
          creditsAvailable: '0.00',
          feeAccruedOnBase: '5000.00',
        },
        deposit: {
          amount: '100000.00',
          currency: 'ARS',
          returnMode: 'FOLLOWS_RENT',
          suggestedReturn: '100000.00',
        },
      })
      expect(account.body.data.installments).toHaveLength(1)
      expect(
        account.body.data.movements.map((m: { type: string }) => m.type),
      ).toEqual(['DEPOSIT_RECEIVED', 'INSTALLMENT', 'LATE_FEE_ACCRUED'])
      expect(account.body.data.movements[2].balance).toBe(
        (100000 + day * 5000).toFixed(2),
      )

      const missing = await api(adminToken)
        .get(`/contracts/${UNKNOWN_ID}/account`)
        .expect(422)
      expect(missing.body.code).toBe('INSTALLMENT_INVALID_CONTRACT')
    })
  })

  describe('aislamiento entre inmobiliarias', () => {
    it('la generación y los listados son por inmobiliaria; otra no ve la cuota ni la cuenta corriente', async () => {
      const contract = await createContract()
      await createContract({}, adminBToken, refsB)

      expect(await generate(period, adminToken)).toMatchObject({ created: 1 })
      expect(await generate(period, adminBToken)).toMatchObject({ created: 1 })

      const { id } = await installmentOf(contract.id)
      const b = api(adminBToken)
      await b.get(`/billing/installments/${id}`).expect(404)
      await b.get(`/billing/installments/${id}/breakdown`).expect(404)
      await b.get(`/contracts/${contract.id}/account`).expect(422)
      const list = await b
        .get(`/billing/installments?period=${period}`)
        .expect(200)
      expect(list.body.data.pagination.total).toBe(1)
      expect(list.body.data.data[0].contract.id).not.toBe(contract.id)
    })
  })
})
