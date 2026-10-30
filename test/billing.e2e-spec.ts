import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import request from 'supertest'

import { seedBaseMasterData } from '../prisma/lib/master-data-seed'
import {
  BillingFacade,
  INSTALLMENT_PAID_QUEUE,
  InstallmentPaidPayload,
  PAYMENT_CONFIRMED_QUEUE,
  PAYMENT_VOIDED_QUEUE,
  PaymentConfirmedPayload,
  PaymentVoidedPayload,
} from '../src/modules/billing/public'
import { RequestContext } from '../src/shared/context/request-context'
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
import { waitFor } from './utils/wait-for'

const PDF = Buffer.from('%PDF-1.4 comprobante')
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

const today = todayIso()
const period = periodOf(today)
/** El mes pasado: todas sus fechas ya pasaron, así los pagos se fechan sin mirar qué día es hoy. */
const previous = periodOf(addMonths(today, -1))
const day = (n: number, inPeriod = previous) =>
  `${inPeriod}-${String(n).padStart(2, '0')}`

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
  /**
   * Lo publicado en una cola, leído de las tablas de pg-boss. El test no se
   * suscribe: liquidaciones (Fase 12) ya consume estas colas y pg-boss le
   * entrega cada trabajo a un solo worker, así que competir por el mensaje
   * haría al test intermitente.
   */
  const published = async <T>(queue: string): Promise<T[]> => {
    const rows = await prisma.$queryRawUnsafe<{ data: { payload: T } }[]>(
      `SELECT data FROM pgboss.job WHERE name = $1
       UNION ALL SELECT data FROM pgboss.archive WHERE name = $1`,
      queue,
    )
    return rows.map((row) => row.data.payload)
  }
  const paidEvents = () =>
    published<InstallmentPaidPayload>(INSTALLMENT_PAID_QUEUE.name)
  const confirmedEvents = () =>
    published<PaymentConfirmedPayload>(PAYMENT_CONFIRMED_QUEUE.name)
  const voidedEvents = () =>
    published<PaymentVoidedPayload>(PAYMENT_VOIDED_QUEUE.name)

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

  /** Registra un pago por multipart; sin `file` no manda comprobante. */
  const pay = (
    installmentId: string,
    fields: Record<string, string>,
    options: { token?: string; file?: Buffer } = {},
  ) => {
    const req = api(options.token ?? adminToken).post(
      `/billing/installments/${installmentId}/payments`,
    )
    for (const [key, value] of Object.entries({
      paidCurrency: 'ARS',
      method: 'TRANSFER',
      ...fields,
    })) {
      req.field(key, value)
    }
    if (options.file) {
      req.attach('file', options.file, {
        filename: 'ticket.pdf',
        contentType: 'application/pdf',
      })
    }
    return req
  }

  const inTenantA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ correlationId: 'test' }, () =>
      RequestContext.runInTenant(tenantA.id, fn),
    )

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

  describe('pagos (3.3, reglas 3 a 8)', () => {
    it('un pago entero dentro de la gracia salda la cuota, congela el detalle y avisa por la cola', async () => {
      const contract = await createContract({ lateFeeGraceDays: 10 })
      await generate(previous)
      const { id } = await installmentOf(contract.id, previous)

      const response = await pay(
        id,
        {
          paidAt: day(5),
          amount: '100000',
          notes: '  Transferencia  Galicia ',
        },
        { token: employeeToken, file: PDF },
      ).expect(201)
      expect(response.body.data.payment).toMatchObject({
        installmentId: id,
        contractId: contract.id,
        renterId: contract.renterId,
        period: previous,
        paidAt: day(5),
        paidCurrency: 'ARS',
        amount: '100000.00',
        exchangeRate: null,
        amountInContractCurrency: '100000.00',
        kind: 'CASH_IN',
        method: 'TRANSFER',
        receivedBy: 'AGENCY',
        status: 'CONFIRMED',
        lateFeeApplied: '0.00',
        rentApplied: '100000.00',
        chargesApplied: '0.00',
        creditGenerated: '0.00',
        notes: 'Transferencia Galicia',
        registeredBy: { fullName: 'emp@a.com' },
      })
      expect(response.body.data.payment.receiptUrl).toContain('payments/')
      expect(response.body.data.creditApplications).toEqual([])
      expect(response.body.data.installment).toMatchObject({
        id,
        status: 'PAID',
        paidAt: day(5),
        paidTotal: '100000.00',
        totalDue: '0.00',
        feeDays: 0,
        lateFeeDays: [],
        feeOnCollected: '5000.00',
      })

      await waitFor(async () =>
        (await paidEvents()).some((e) => e.installmentId === id),
      )
      expect((await paidEvents()).find((e) => e.installmentId === id)).toEqual({
        installmentId: id,
        contractId: contract.id,
        ownerId: contract.ownerId,
        period: previous,
      })

      // Sobre una cuota saldada no se cobra más.
      const again = await pay(id, { paidAt: day(6), amount: '1' }).expect(409)
      expect(again.body.code).toBe('INSTALLMENT_ALREADY_PAID')

      const paidList = await api(adminToken)
        .get(`/billing/installments?period=${previous}&status=PAID`)
        .expect(200)
      expect(paidList.body.data.data.map((i: { id: string }) => i.id)).toEqual([
        id,
      ])
    })

    it('dos pagos parciales: el punitorio del segundo tramo baja con el saldo (A-3, A-8)', async () => {
      // Gracia 0: el punitorio corre desde el día 1 del mes pasado, 5 % de
      // 100.000 = 5.000 por día sobre el saldo impago.
      const contract = await createContract()
      await generate(previous)
      const { id } = await installmentOf(contract.id, previous)

      // Día 2: deben 100.000 + 2 días × 5.000 = 110.000. Pagan 60.000:
      // primero el punitorio (10.000), después alquiler (50.000).
      const first = await pay(id, { paidAt: day(2), amount: '60000' }).expect(
        201,
      )
      expect(first.body.data.payment).toMatchObject({
        lateFeeApplied: '10000.00',
        rentApplied: '50000.00',
        chargesApplied: '0.00',
        creditGenerated: '0.00',
      })
      expect(first.body.data.installment).toMatchObject({
        status: 'OVERDUE',
        rentBalance: '50000.00',
        paidAt: null,
      })

      // Días 3 y 4 devengan sobre 50.000: 2.500 cada uno. Día 4 deben
      // 50.000 + 5.000 = 55.000 → saldada el día 4.
      const breakdown = await api(adminToken)
        .get(`/billing/installments/${id}/breakdown?asOf=${day(4)}`)
        .expect(200)
      expect(breakdown.body.data).toMatchObject({
        feeDays: 4,
        lateFeeAccrued: '15000.00',
        lateFeePaid: '10000.00',
        lateFeeBalance: '5000.00',
        rentBalance: '50000.00',
        totalDue: '55000.00',
      })
      const second = await pay(id, {
        paidAt: day(4),
        amount: '55000',
        method: 'CASH',
      }).expect(201)
      expect(second.body.data.payment).toMatchObject({
        lateFeeApplied: '5000.00',
        rentApplied: '50000.00',
      })
      expect(second.body.data.installment).toMatchObject({
        status: 'PAID',
        paidAt: day(4),
        feeDays: 4,
        lateFeeAccrued: '15000.00',
        totalDue: '0.00',
      })
      expect(
        second.body.data.installment.lateFeeDays.map(
          (d: { outstandingBase: string; amount: string }) => [
            d.outstandingBase,
            d.amount,
          ],
        ),
      ).toEqual([
        ['100000.00', '5000.00'],
        ['100000.00', '5000.00'],
        ['50000.00', '2500.00'],
        ['50000.00', '2500.00'],
      ])
      // Congelado: a hoy sigue siendo lo mismo.
      expect(await detail(id)).toMatchObject({
        feeDays: 4,
        lateFeeAccrued: '15000.00',
        status: 'PAID',
      })

      // Imputación manual: cada concepto hasta su saldo.
      const other = await createContract()
      await generate(previous)
      const second2 = await installmentOf(other.id, previous)
      const manual = await pay(second2.id, {
        paidAt: day(1),
        amount: '20000',
        allocation: JSON.stringify({ lateFee: '0', rent: '20000' }),
      }).expect(201)
      expect(manual.body.data.payment).toMatchObject({
        lateFeeApplied: '0.00',
        rentApplied: '20000.00',
      })
      const bad = await pay(second2.id, {
        paidAt: day(2),
        amount: '20000',
        allocation: JSON.stringify({ lateFee: '0', rent: '90000' }),
      }).expect(400)
      expect(bad.body.code).toBe('PAYMENT_INVALID_ALLOCATION')
      const future = await pay(second2.id, {
        paidAt: addDays(today, 1),
        amount: '1',
      }).expect(400)
      expect(future.body.code).toBe('PAYMENT_INVALID_DATE')
      const zero = await pay(second2.id, {
        paidAt: day(2),
        amount: '0',
      }).expect(400)
      expect(zero.body.code).toBe('PAYMENT_INVALID_AMOUNT')
      const badReceipt = await pay(
        second2.id,
        { paidAt: day(2), amount: '10' },
        { file: Buffer.from('no soy un pdf') },
      ).expect(400)
      expect(badReceipt.body.code).toBe('PAYMENT_INVALID_RECEIPT')
    })

    it('un contrato en USD cobra en pesos con cotización obligatoria (A-9)', async () => {
      // Gracia larga: la cuota del mes pasado sigue sin punitorio hoy.
      const contract = await createContract({
        currency: 'USD',
        initialRent: '1000',
        lateFeeGraceDays: 90,
      })
      await generate(previous)
      const { id } = await installmentOf(contract.id, previous)

      const noRate = await pay(id, {
        paidAt: day(3),
        amount: '744000',
        paidCurrency: 'ARS',
      }).expect(400)
      expect(noRate.body.code).toBe('PAYMENT_EXCHANGE_RATE_REQUIRED')

      const paid = await pay(id, {
        paidAt: day(3),
        amount: '744000',
        paidCurrency: 'ARS',
        exchangeRate: '1488',
        exchangeRateSource: 'MEP',
        exchangeRateDate: day(3),
      }).expect(201)
      expect(paid.body.data.payment).toMatchObject({
        paidCurrency: 'ARS',
        amount: '744000.00',
        exchangeRate: '1488.0000',
        exchangeRateSource: 'MEP',
        exchangeRateDate: day(3),
        amountInContractCurrency: '500.00',
        rentApplied: '500.00',
      })
      expect(paid.body.data.installment).toMatchObject({
        status: 'PARTIAL',
        currency: 'USD',
        rentBalance: '500.00',
        paidTotal: '500.00',
      })

      const notAllowed = await pay(id, {
        paidAt: day(4),
        amount: '500',
        paidCurrency: 'USD',
        exchangeRate: '1488',
        exchangeRateSource: 'MEP',
        exchangeRateDate: day(4),
      }).expect(400)
      expect(notAllowed.body.code).toBe('PAYMENT_EXCHANGE_RATE_NOT_ALLOWED')

      const rest = await pay(id, {
        paidAt: day(4),
        amount: '500',
        paidCurrency: 'USD',
      }).expect(201)
      expect(rest.body.data.installment.status).toBe('PAID')
    })

    it('cobro directo del propietario: el pago nace informado y se confirma; la lista de pendientes lo muestra (A-11)', async () => {
      const contract = await createContract({
        collectionMode: 'OWNER_DIRECT',
        lateFeeGraceDays: 31,
      })
      await generate(previous)
      const { id } = await installmentOf(contract.id, previous)

      const informed = await pay(id, {
        paidAt: day(5),
        amount: '100000',
      }).expect(201)
      const paymentId = informed.body.data.payment.id as string
      expect(informed.body.data.payment).toMatchObject({
        receivedBy: 'OWNER',
        status: 'PENDING_CONFIRMATION',
        confirmedAt: null,
      })
      // Cuenta como pagado igual: la cuota queda saldada.
      expect(informed.body.data.installment).toMatchObject({
        status: 'PAID',
        pendingConfirmationTotal: '100000.00',
        feeOnCollected: '0.00',
      })

      const pending = await api(adminToken)
        .get('/billing/payments?status=PENDING_CONFIRMATION&receivedBy=OWNER')
        .expect(200)
      expect(pending.body.data.pagination.total).toBe(1)
      expect(pending.body.data.data[0]).toMatchObject({
        id: paymentId,
        renter: { id: contract.renterId },
        property: { id: contract.propertyId },
        currency: 'ARS',
      })

      const confirmed = await api(employeeToken)
        .post(`/billing/payments/${paymentId}/confirm`)
        .expect(200)
      expect(confirmed.body.data).toMatchObject({
        id: paymentId,
        status: 'CONFIRMED',
        confirmedBy: { fullName: 'emp@a.com' },
      })
      expect(confirmed.body.data.confirmedAt).not.toBeNull()
      const twice = await api(adminToken)
        .post(`/billing/payments/${paymentId}/confirm`)
        .expect(409)
      expect(twice.body.code).toBe('PAYMENT_ALREADY_CONFIRMED')
      expect((await detail(id)).feeOnCollected).toBe('5000.00')

      const byContract = await api(adminToken)
        .get(
          `/billing/payments?contractId=${contract.id}&from=${day(1)}&to=${day(31 > 28 ? 28 : 31)}`,
        )
        .expect(200)
      expect(byContract.body.data.pagination.total).toBe(1)

      // La facade de liquidaciones ve lo cobrado por el propietario.
      const collections = await inTenantA(() =>
        app.get(BillingFacade).collectionsByInstallment([id]),
      )
      expect(collections.get(id)).toMatchObject({
        rentCollectedByAgency: '0.00',
        rentCollectedByOwner: '100000.00',
        feeOnCollected: '5000.00',
        collectionMode: 'OWNER_DIRECT',
      })
    })

    it('anular un pago (sólo admin) reabre la cuota y vuelve a calcular el punitorio en vivo', async () => {
      const contract = await createContract()
      await generate(previous)
      const { id } = await installmentOf(contract.id, previous)
      const paid = await pay(id, { paidAt: day(2), amount: '110000' }).expect(
        201,
      )
      const paymentId = paid.body.data.payment.id as string
      expect(paid.body.data.installment).toMatchObject({
        status: 'PAID',
        feeDays: 2,
      })

      await api(employeeToken)
        .post(`/billing/payments/${paymentId}/void`)
        .send({ reason: 'x' })
        .expect(403)

      const voided = await api(adminToken)
        .post(`/billing/payments/${paymentId}/void`)
        .send({ reason: 'Transferencia rechazada' })
        .expect(200)
      expect(voided.body.data).toMatchObject({
        id,
        status: 'OVERDUE',
        paidAt: null,
        paidTotal: '0.00',
        rentBalance: '100000.00',
      })
      // Sin el pago, el punitorio sigue corriendo hasta hoy.
      expect(voided.body.data.feeDays).toBeGreaterThan(2)
      expect(voided.body.data.payments[0]).toMatchObject({
        id: paymentId,
        status: 'VOIDED',
        voidReason: 'Transferencia rechazada',
        voidedBy: { fullName: 'admin@a.com' },
      })
      const twice = await api(adminToken)
        .post(`/billing/payments/${paymentId}/void`)
        .send({ reason: 'otra vez' })
        .expect(409)
      expect(twice.body.code).toBe('PAYMENT_ALREADY_VOIDED')

      const account = await api(adminToken)
        .get(`/contracts/${contract.id}/account`)
        .expect(200)
      expect(
        account.body.data.movements.map((m: { type: string }) => m.type),
      ).toEqual(
        expect.arrayContaining([
          'PAYMENT',
          'PAYMENT_VOIDED',
          'LATE_FEE_ACCRUED',
        ]),
      )
      expect(account.body.data.totals.collected).toBe('0.00')
    })

    it('el exceso genera saldo a favor, que se aplica solo al próximo pago, a mano, o se devuelve (A-6)', async () => {
      const contract = await createContract({ lateFeeGraceDays: 31 })
      await generate(previous)
      await generate(period)
      const first = await installmentOf(contract.id, previous)
      const second = await installmentOf(contract.id, period)

      const over = await pay(first.id, {
        paidAt: day(5),
        amount: '130000',
      }).expect(201)
      expect(over.body.data.payment).toMatchObject({
        rentApplied: '100000.00',
        creditGenerated: '30000.00',
      })
      expect(over.body.data.installment.status).toBe('PAID')

      const credits = await api(adminToken)
        .get(`/billing/renters/${contract.renterId}/credits`)
        .expect(200)
      expect(credits.body.data).toMatchObject({
        renterId: contract.renterId,
        totals: [{ currency: 'ARS', available: '30000.00' }],
      })
      expect(credits.body.data.credits).toHaveLength(1)
      const creditId = credits.body.data.credits[0].id as string
      expect(credits.body.data.credits[0]).toMatchObject({
        amount: '30000.00',
        remaining: '30000.00',
        status: 'AVAILABLE',
        originPaymentId: over.body.data.payment.id,
      })
      expect((await detail(second.id)).creditsAvailable).toBe('30000.00')

      // Anular el pago que generó el crédito mientras está entero lo anula.
      // (Se prueba con otro contrato más abajo; acá se aplica a mano.)
      const applied = await api(employeeToken)
        .post(`/billing/installments/${second.id}/apply-credit`)
        .send({ amount: '10000' })
        .expect(201)
      expect(applied.body.data.payment).toMatchObject({
        kind: 'CREDIT_APPLICATION',
        method: 'CREDIT',
        status: 'CONFIRMED',
        amount: '10000.00',
        rentApplied: '10000.00',
        creditId,
      })
      expect(applied.body.data.installment).toMatchObject({
        status: 'PARTIAL',
        rentBalance: '90000.00',
        creditsAvailable: '20000.00',
      })

      // Al cobrar, primero se aplica el crédito que queda, después la plata.
      const cash = await pay(second.id, {
        paidAt: today,
        amount: '70000',
      }).expect(201)
      expect(cash.body.data.creditApplications).toHaveLength(1)
      expect(cash.body.data.creditApplications[0]).toMatchObject({
        kind: 'CREDIT_APPLICATION',
        amount: '20000.00',
        rentApplied: '20000.00',
      })
      expect(cash.body.data.payment).toMatchObject({
        kind: 'CASH_IN',
        rentApplied: '70000.00',
        creditGenerated: '0.00',
      })
      expect(cash.body.data.installment).toMatchObject({
        status: 'PAID',
        creditsAvailable: '0.00',
      })
      const used = await api(adminToken)
        .get(`/billing/renters/${contract.renterId}/credits`)
        .expect(200)
      expect(used.body.data.credits[0]).toMatchObject({
        remaining: '0.00',
        status: 'APPLIED',
      })
      const none = await api(adminToken)
        .post(`/billing/installments/${second.id}/apply-credit`)
        .send({})
        .expect(409)
      expect(none.body.code).toBe('INSTALLMENT_ALREADY_PAID')

      // Anular el pago original ahora falla: su crédito ya se usó.
      const stuck = await api(adminToken)
        .post(`/billing/payments/${over.body.data.payment.id}/void`)
        .send({ reason: 'error' })
        .expect(409)
      expect(stuck.body.code).toBe('PAYMENT_CREDIT_ALREADY_USED')

      // Devolución: otro crédito, sin usar.
      const other = await createContract({ lateFeeGraceDays: 31 })
      await generate(previous)
      const otherInstallment = await installmentOf(other.id, previous)
      await pay(otherInstallment.id, {
        paidAt: day(5),
        amount: '150000',
      }).expect(201)
      const otherCredits = await api(adminToken)
        .get(`/billing/renters/${other.renterId}/credits`)
        .expect(200)
      const refundable = otherCredits.body.data.credits[0].id as string
      await api(employeeToken)
        .post(`/billing/credits/${refundable}/refund`)
        .send({ refundedAt: today, method: 'TRANSFER' })
        .expect(403)
      const refunded = await api(adminToken)
        .post(`/billing/credits/${refundable}/refund`)
        .send({
          refundedAt: today,
          method: 'TRANSFER',
          notes: 'CBU del inquilino',
        })
        .expect(200)
      expect(refunded.body.data).toMatchObject({
        status: 'REFUNDED',
        remaining: '0.00',
        refundedAt: today,
        refundMethod: 'TRANSFER',
        refundNotes: 'CBU del inquilino',
      })
      const again = await api(adminToken)
        .post(`/billing/credits/${refundable}/refund`)
        .send({ refundedAt: today, method: 'CASH' })
        .expect(409)
      expect(again.body.code).toBe('CREDIT_NOT_AVAILABLE')
      const unknownRenter = await api(adminToken)
        .get(`/billing/renters/${UNKNOWN_ID}/credits`)
        .expect(404)
      expect(unknownRenter.body.code).toBe('CREDIT_RENTER_NOT_FOUND')
    })

    it('condonar o reducir el punitorio es de admin y queda registrado (Micaela #4)', async () => {
      const contract = await createContract()
      await generate(period)
      const { id } = await installmentOf(contract.id)
      const accrued = (await detail(id)).lateFeeAccrued as string
      expect(Number(accrued)).toBeGreaterThan(0)

      await api(employeeToken)
        .post(`/billing/installments/${id}/late-fee-adjustments`)
        .send({ kind: 'WAIVE', reason: 'x' })
        .expect(403)

      const tooMuch = await api(adminToken)
        .post(`/billing/installments/${id}/late-fee-adjustments`)
        .send({ kind: 'REDUCE', amount: '99999999', reason: 'Acuerdo' })
        .expect(400)
      expect(tooMuch.body.code).toBe('LATE_FEE_INVALID_ADJUSTMENT')

      const reduced = await api(adminToken)
        .post(`/billing/installments/${id}/late-fee-adjustments`)
        .send({
          kind: 'REDUCE',
          amount: '1000',
          reason: 'Acuerdo con el inquilino',
        })
        .expect(201)
      expect(reduced.body.data).toMatchObject({
        lateFeeAccrued: accrued,
        lateFeeAdjusted: '1000.00',
        lateFeeBalance: (Number(accrued) - 1000).toFixed(2),
      })
      expect(reduced.body.data.lateFeeAdjustments[0]).toMatchObject({
        kind: 'REDUCE',
        amount: '1000.00',
        reason: 'Acuerdo con el inquilino',
        createdBy: { fullName: 'admin@a.com' },
      })

      const waived = await api(adminToken)
        .post(`/billing/installments/${id}/late-fee-adjustments`)
        .send({ kind: 'WAIVE', reason: 'Primera vez que se atrasa' })
        .expect(201)
      expect(waived.body.data).toMatchObject({
        lateFeeWaived: true,
        lateFeeAccrued: '0.00',
        lateFeeBalance: '0.00',
        totalDue: '100000.00',
        status: 'OVERDUE',
        feeDays: 0,
        lateFeeDays: [],
      })
      expect(waived.body.data.lateFeeAdjustments[1]).toMatchObject({
        kind: 'WAIVE',
        amount: accrued,
      })
      const twice = await api(adminToken)
        .post(`/billing/installments/${id}/late-fee-adjustments`)
        .send({ kind: 'WAIVE', reason: 'otra' })
        .expect(400)
      expect(twice.body.code).toBe('LATE_FEE_INVALID_ADJUSTMENT')

      // Condonado, pagar el alquiler solo salda la cuota.
      const paid = await pay(id, { paidAt: today, amount: '100000' }).expect(
        201,
      )
      expect(paid.body.data.installment.status).toBe('PAID')
    })

    it('un cargo (multa de rescisión) suma al saldo, no devenga punitorio y se anula si nada se le imputó (A-10)', async () => {
      const contract = await createContract({ lateFeeGraceDays: 90 })
      await generate(previous)
      const { id } = await installmentOf(contract.id, previous)

      const charged = await api(employeeToken)
        .post(`/billing/installments/${id}/charges`)
        .send({
          concept: 'TERMINATION_PENALTY',
          description: 'Multa por rescisión anticipada',
          amount: '10000',
        })
        .expect(201)
      expect(charged.body.data).toMatchObject({
        chargesTotal: '10000.00',
        chargesBalance: '10000.00',
        totalDue: '110000.00',
        lateFeeAccrued: '0.00',
      })
      const chargeId = charged.body.data.charges[0].id as string
      expect(charged.body.data.charges[0]).toMatchObject({
        concept: 'TERMINATION_PENALTY',
        description: 'Multa por rescisión anticipada',
        amount: '10000.00',
        createdBy: { fullName: 'emp@a.com' },
        voidedAt: null,
      })
      const bad = await api(adminToken)
        .post(`/billing/installments/${id}/charges`)
        .send({ concept: 'OTHER', description: 'x', amount: '0' })
        .expect(400)
      expect(bad.body.code).toBe('CHARGE_INVALID_AMOUNT')

      // Paga el alquiler y parte del cargo: ya no se puede anular.
      await pay(id, { paidAt: day(5), amount: '105000' }).expect(201)
      const stuck = await api(adminToken)
        .post(`/billing/charges/${chargeId}/void`)
        .send({ reason: 'error' })
        .expect(409)
      expect(stuck.body.code).toBe('CHARGE_HAS_ALLOCATIONS')

      // Otro cargo sin imputar sí se anula, y la cuota queda PARTIAL por el resto.
      const second = await api(adminToken)
        .post(`/billing/installments/${id}/charges`)
        .send({ concept: 'SERVICE', description: 'Expensas', amount: '3000' })
        .expect(201)
      const secondId = second.body.data.charges[1].id as string
      const voided = await api(adminToken)
        .post(`/billing/charges/${secondId}/void`)
        .send({ reason: 'Cargado dos veces' })
        .expect(200)
      expect(voided.body.data).toMatchObject({
        chargesTotal: '10000.00',
        chargesBalance: '5000.00',
        status: 'PARTIAL',
      })
      expect(voided.body.data.charges[1]).toMatchObject({
        voidReason: 'Cargado dos veces',
      })
      await pay(id, { paidAt: day(6), amount: '5000' }).expect(201)
      const onPaid = await api(adminToken)
        .post(`/billing/installments/${id}/charges`)
        .send({ concept: 'OTHER', description: 'Tarde', amount: '1' })
        .expect(409)
      expect(onPaid.body.code).toBe('INSTALLMENT_ALREADY_PAID')
    })

    it('la mora por inquilino resume vencidas, días y saldos; la facade da lo mismo', async () => {
      const overdue = await createContract()
      const upToDate = await createContract({ lateFeeGraceDays: 31 })
      await generate(period)
      const paid = await installmentOf(upToDate.id)
      await pay(paid.id, { paidAt: today, amount: '100000' }).expect(201)

      const arrears = await api(adminToken)
        .get(
          `/billing/arrears?renterId=${overdue.renterId}&renterId=${upToDate.renterId}&renterIds=${UNKNOWN_ID}`,
        )
        .expect(200)
      expect(arrears.body.data).toHaveLength(3)
      const todayDay = Number(today.slice(8, 10))
      expect(arrears.body.data[0]).toEqual({
        renterId: overdue.renterId,
        status: 'OVERDUE',
        overdueInstallments: 1,
        maxDaysOverdue: todayDay,
        lateFeeAccrued: [
          { currency: 'ARS', amount: (todayDay * 5000).toFixed(2) },
        ],
        balance: [
          { currency: 'ARS', amount: (100000 + todayDay * 5000).toFixed(2) },
        ],
      })
      expect(arrears.body.data[1]).toMatchObject({
        renterId: upToDate.renterId,
        status: 'UP_TO_DATE',
        overdueInstallments: 0,
        lateFeeAccrued: [],
        balance: [],
      })
      expect(arrears.body.data[2]).toMatchObject({
        renterId: UNKNOWN_ID,
        status: 'UP_TO_DATE',
      })

      const facade = app.get(BillingFacade)
      const viaFacade = await inTenantA(() =>
        facade.arrearsByRenter([overdue.renterId]),
      )
      expect(viaFacade[0]).toMatchObject({ status: 'OVERDUE' })
      const overdueList = await inTenantA(() => facade.listOverdue())
      expect(overdueList.map((i) => i.contractId)).toEqual([overdue.id])
      expect(overdueList[0].daysOverdue).toBe(todayDay)
      expect(
        await inTenantA(() => facade.generateInstallments(nextPeriod(period))),
      ).toMatchObject({ created: 2 })
    })
  })

  describe('para liquidaciones (Fase 12, 2.2)', () => {
    it('publica payment-confirmed al confirmar y payment-voided al anular; la facade entrega los pagos liquidables y los marca', async () => {
      const contract = await createContract({ lateFeeGraceDays: 90 })
      await generate(previous)
      const { id } = await installmentOf(contract.id, previous)
      await api(adminToken)
        .post(`/billing/installments/${id}/charges`)
        .send({ concept: 'SERVICE', description: 'Expensas', amount: '3000' })
        .expect(201)
      await api(adminToken)
        .post(`/billing/installments/${id}/charges`)
        .send({ concept: 'OTHER', description: 'Llave', amount: '1000' })
        .expect(201)
      // Cubre el alquiler y los dos cargos: 100.000 + 3.000 + 1.000.
      const paid = await pay(id, { paidAt: day(5), amount: '104000' }).expect(
        201,
      )
      const paymentId = paid.body.data.payment.id as string
      expect(paid.body.data.payment.settlementId).toBeNull()

      await waitFor(async () =>
        (await confirmedEvents()).some((e) => e.paymentId === paymentId),
      )
      expect(
        (await confirmedEvents()).find((e) => e.paymentId === paymentId),
      ).toMatchObject({
        installmentId: id,
        contractId: contract.id,
        ownerId: contract.ownerId,
        renterId: contract.renterId,
        period: previous,
        receivedBy: 'AGENCY',
        kind: 'CASH_IN',
        rentApplied: '100000.00',
        lateFeeApplied: '0.00',
        chargesApplied: '4000.00',
        currency: 'ARS',
      })

      const facade = app.get(BillingFacade)
      const settleable = await inTenantA(() =>
        facade.listSettleablePayments(contract.id),
      )
      expect(settleable).toHaveLength(1)
      expect(settleable[0]).toMatchObject({
        paymentId,
        installmentId: id,
        paidAt: day(5),
        rentApplied: '100000.00',
        lateFeeApplied: '0.00',
        chargesApplied: {
          SERVICE: '3000.00',
          TERMINATION_PENALTY: '0.00',
          OTHER: '1000.00',
        },
        currency: 'ARS',
        installment: {
          installmentId: id,
          period: previous,
          baseAmount: '100000.00',
          feeMode: 'DEDUCTED',
          feePercentage: '5.00',
          feeAmount: null,
        },
      })
      const terms = await inTenantA(() => facade.feeTermsForInstallments([id]))
      expect(terms.get(id)).toMatchObject({ feePercentage: '5.00' })

      const settlementId = '11111111-1111-4111-8111-111111111111'
      expect(
        await inTenantA(() =>
          facade.markPaymentsSettled([paymentId], settlementId),
        ),
      ).toBe(1)
      expect(
        await inTenantA(() =>
          facade.markPaymentsSettled([paymentId], settlementId),
        ),
      ).toBe(0)
      expect(
        await inTenantA(() => facade.listSettleablePayments(contract.id)),
      ).toEqual([])
      expect((await detail(id)).payments[0].settlementId).toBe(settlementId)

      // Anular un pago liquidado avisa con la liquidación.
      await api(adminToken)
        .post(`/billing/payments/${paymentId}/void`)
        .send({ reason: 'Rebotó' })
        .expect(200)
      await waitFor(async () =>
        (await voidedEvents()).some((e) => e.paymentId === paymentId),
      )
      expect(
        (await voidedEvents()).find((e) => e.paymentId === paymentId),
      ).toMatchObject({
        installmentId: id,
        contractId: contract.id,
        settlementId,
        rentApplied: '100000.00',
        voidReason: 'Rebotó',
      })
      expect(
        await inTenantA(() => facade.unmarkPaymentsSettled(settlementId)),
      ).toBe(1)
    })

    it('devuelve el depósito con deducciones: una deuda imputada a una cuota crea un pago DEPOSIT y la cuenta corriente lo muestra', async () => {
      const contract = await createContract({
        startDate: addMonths(today, -3),
        endDate: addDays(today, -1),
        lateFeeGraceDays: 90,
      })
      await generate(previous)
      const { id } = await installmentOf(contract.id, previous)
      await pay(id, { paidAt: day(5), amount: '70000' }).expect(201)

      const active = await createContract()
      const stillActive = await api(adminToken)
        .post(`/contracts/${active.id}/deposit-return`)
        .send({
          returnedAt: today,
          returnedAmount: '100000',
          method: 'TRANSFER',
          deductions: [],
        })
        .expect(409)
      expect(stillActive.body.code).toBe('DEPOSIT_RETURN_CONTRACT_ACTIVE')

      const unbalanced = await api(adminToken)
        .post(`/contracts/${contract.id}/deposit-return`)
        .send({
          returnedAt: today,
          returnedAmount: '50000',
          method: 'TRANSFER',
          deductions: [
            { concept: 'DAMAGE', description: 'Pintura', amount: '10000' },
          ],
        })
        .expect(400)
      expect(unbalanced.body.code).toBe('DEPOSIT_RETURN_UNBALANCED')

      const tooMuch = await api(adminToken)
        .post(`/contracts/${contract.id}/deposit-return`)
        .send({
          returnedAt: today,
          returnedAmount: '50000',
          method: 'TRANSFER',
          deductions: [
            {
              concept: 'DEBT',
              description: 'Cuota impaga',
              amount: '50000',
              installmentId: id,
            },
          ],
        })
        .expect(400)
      expect(tooMuch.body.code).toBe('DEPOSIT_RETURN_INVALID_DEDUCTION')

      const returned = await api(employeeToken)
        .post(`/contracts/${contract.id}/deposit-return`)
        .send({
          returnedAt: today,
          returnedAmount: '60000',
          method: 'TRANSFER',
          notes: 'Transferido al inquilino',
          deductions: [
            {
              concept: 'DEBT',
              description: 'Saldo de la cuota',
              amount: '30000',
              installmentId: id,
            },
            { concept: 'DAMAGE', description: 'Pintura', amount: '10000' },
          ],
        })
        .expect(201)
      expect(returned.body.data).toMatchObject({
        contractId: contract.id,
        returnedAt: today,
        depositAmount: '100000.00',
        depositCurrency: 'ARS',
        returnedAmount: '60000.00',
        method: 'TRANSFER',
        notes: 'Transferido al inquilino',
        registeredBy: { fullName: 'emp@a.com' },
      })
      expect(returned.body.data.deductions).toHaveLength(2)
      const debt = returned.body.data.deductions[0]
      expect(debt).toMatchObject({
        concept: 'DEBT',
        amount: '30000.00',
        installmentId: id,
      })
      expect(debt.paymentId).not.toBeNull()
      expect(returned.body.data.deductions[1]).toMatchObject({
        concept: 'DAMAGE',
        installmentId: null,
        paymentId: null,
      })

      // La cuota quedó saldada con un pago DEPOSIT recibido por la inmobiliaria.
      const full = await detail(id)
      expect(full).toMatchObject({ status: 'PAID', rentBalance: '0.00' })
      expect(full.payments[0]).toMatchObject({
        id: debt.paymentId,
        method: 'DEPOSIT',
        kind: 'CASH_IN',
        receivedBy: 'AGENCY',
        status: 'CONFIRMED',
        rentApplied: '30000.00',
        paidAt: today,
      })

      const account = await api(adminToken)
        .get(`/contracts/${contract.id}/account`)
        .expect(200)
      expect(account.body.data.deposit.returned).toMatchObject({
        id: returned.body.data.id,
        returnedAmount: '60000.00',
      })
      expect(
        account.body.data.movements.map((m: { type: string }) => m.type),
      ).toEqual(
        expect.arrayContaining([
          'PAYMENT',
          'DEPOSIT_RETURNED',
          'DEPOSIT_DEDUCTION',
        ]),
      )

      const twice = await api(adminToken)
        .post(`/contracts/${contract.id}/deposit-return`)
        .send({
          returnedAt: today,
          returnedAmount: '100000',
          method: 'CASH',
          deductions: [],
        })
        .expect(409)
      expect(twice.body.code).toBe('DEPOSIT_RETURN_EXISTS')
      await api(adminBToken)
        .post(`/contracts/${contract.id}/deposit-return`)
        .send({
          returnedAt: today,
          returnedAmount: '100000',
          method: 'CASH',
          deductions: [],
        })
        .expect(422)
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

    it('otra inmobiliaria no cobra, confirma, anula ni ve pagos, cargos o créditos ajenos', async () => {
      const contract = await createContract({ collectionMode: 'OWNER_DIRECT' })
      await generate(period)
      const { id } = await installmentOf(contract.id)
      const paid = await pay(id, { paidAt: today, amount: '20000' }).expect(201)
      const paymentId = paid.body.data.payment.id as string
      const charged = await api(adminToken)
        .post(`/billing/installments/${id}/charges`)
        .send({ concept: 'OTHER', description: 'x', amount: '100' })
        .expect(201)
      const chargeId = charged.body.data.charges[0].id as string

      const b = api(adminBToken)
      await pay(
        id,
        { paidAt: today, amount: '1' },
        { token: adminBToken },
      ).expect(404)
      await b.post(`/billing/payments/${paymentId}/confirm`).expect(404)
      await b
        .post(`/billing/payments/${paymentId}/void`)
        .send({ reason: 'x' })
        .expect(404)
      await b
        .post(`/billing/charges/${chargeId}/void`)
        .send({ reason: 'x' })
        .expect(404)
      await b
        .post(`/billing/installments/${id}/late-fee-adjustments`)
        .send({ kind: 'WAIVE', reason: 'x' })
        .expect(404)
      await b
        .post(`/billing/installments/${id}/apply-credit`)
        .send({})
        .expect(404)
      await b.get(`/billing/renters/${contract.renterId}/credits`).expect(404)
      const payments = await b
        .get('/billing/payments?status=PENDING_CONFIRMATION')
        .expect(200)
      expect(payments.body.data.pagination.total).toBe(0)
      const arrears = await b
        .get(`/billing/arrears?renterId=${contract.renterId}`)
        .expect(200)
      expect(arrears.body.data[0]).toMatchObject({ status: 'UP_TO_DATE' })
    })
  })
})
