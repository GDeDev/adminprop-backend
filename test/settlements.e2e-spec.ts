import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import request from 'supertest'

import { seedBaseMasterData } from '../prisma/lib/master-data-seed'
import {
  SETTLEMENT_CONFIRMED_QUEUE,
  STATEMENT_CLOSED_QUEUE,
  SettlementConfirmedPayload,
  SettlementsFacade,
  StatementClosedPayload,
} from '../src/modules/settlements/public'
import { RequestContext } from '../src/shared/context/request-context'
import { QueuePort } from '../src/platform/queue/queue.port'
import {
  addDays,
  addMonths,
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
/** El mes pasado: sus fechas ya pasaron, así los pagos se fechan sin mirar qué día es hoy. */
const previous = periodOf(addMonths(today, -1))
const day = (n: number, inPeriod = previous) =>
  `${inPeriod}-${String(n).padStart(2, '0')}`

/** Liquidaciones (rediseño Fase 12): creación, honorarios, confirmación, transferencias, consolidados, cuenta de honorarios, aislamiento. */
describe('Liquidaciones (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string }
  let tenantB: { id: string }
  let adminToken: string
  let employeeToken: string
  let adminBToken: string
  let refs: { tolosa: string; casa: string }
  let refsB: { tolosa: string; casa: string }
  const confirmedEvents: SettlementConfirmedPayload[] = []
  const closedEvents: StatementClosedPayload[] = []

  const inTenantA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ correlationId: 'test' }, () =>
      RequestContext.runInTenant(tenantA.id, fn),
    )

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
    delete: (url: string) =>
      request(app.getHttpServer())
        .delete(`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`),
  })

  let counter = 0
  const nextId = () => String(50_000_000 + ++counter)

  const createOwner = async (token = adminToken): Promise<string> => {
    const response = await api(token)
      .post('/owners')
      .send({
        firstName: 'Juan',
        lastName: 'Pérez',
        nationalId: nextId(),
        bankAccount: { cbu: '0110599552000000123456' },
      })
      .expect(201)
    return response.body.data.id
  }

  const createProperty = async (
    ownerId: string,
    token = adminToken,
    master = refs,
  ): Promise<string> => {
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
   * Un contrato activo de 100.000 ARS, honorarios 5 % descontados, gracia
   * larga (sin punitorio) y cobro por la inmobiliaria, salvo overrides.
   */
  const createContract = async (
    overrides: Record<string, unknown> = {},
    options: { token?: string; master?: typeof refs; ownerId?: string } = {},
  ) => {
    const token = options.token ?? adminToken
    const ownerId = options.ownerId ?? (await createOwner(token))
    const propertyId = await createProperty(
      ownerId,
      token,
      options.master ?? refs,
    )
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
        lateFeeGraceDays: 90,
        ...overrides,
      })
      .expect(201)
    return {
      id: response.body.data.id as string,
      propertyId,
      renterId,
      ownerId,
    }
  }

  const generate = async (forPeriod: string, token = adminToken) => {
    await api(token)
      .post('/billing/installments/generate')
      .send({ period: forPeriod })
      .expect(200)
  }

  const installmentOf = async (contractId: string, forPeriod = previous) => {
    const response = await api(adminToken)
      .get(`/billing/installments?contractId=${contractId}&period=${forPeriod}`)
      .expect(200)
    return response.body.data.data[0]
  }

  const pay = (
    installmentId: string,
    fields: Record<string, string>,
    token = adminToken,
  ) => {
    const req = api(token).post(
      `/billing/installments/${installmentId}/payments`,
    )
    for (const [key, value] of Object.entries({
      paidCurrency: 'ARS',
      method: 'TRANSFER',
      ...fields,
    })) {
      req.field(key, value)
    }
    return req
  }

  /** Genera la cuota de un mes y la paga entera (dispara `installment-paid`). */
  const payInstallment = async (
    contractId: string,
    forPeriod: string,
    amount = '100000',
    paidAt = day(5, forPeriod === period ? period : previous),
    fields: Record<string, string> = {},
  ) => {
    await generate(forPeriod)
    const installment = await installmentOf(contractId, forPeriod)
    const response = await pay(installment.id, {
      paidAt,
      amount,
      ...fields,
    }).expect(201)
    return {
      installmentId: installment.id as string,
      paymentId: response.body.data.payment.id as string,
    }
  }

  const createExpense = async (
    contractId: string,
    amount: string,
    currency?: string,
  ) => {
    const req = api(adminToken)
      .post(`/contracts/${contractId}/advance-expenses`)
      .field('amount', amount)
      .field('description', 'Plomero')
      .field('expenseDate', addDays(today, -3))
    if (currency) req.field('currency', currency)
    const response = await req
      .attach('file', PDF, {
        filename: 'ticket.pdf',
        contentType: 'application/pdf',
      })
      .expect(201)
    return response.body.data.id as string
  }

  const settlementsOf = async (contractId: string, token = adminToken) =>
    (await api(token).get(`/settlements?contractId=${contractId}`).expect(200))
      .body.data.data as { id: string; status: string }[]

  /** Espera a que el listener de `installment-paid` deje la pendiente del contrato. */
  const waitForDraft = async (contractId: string) => {
    let found: { id: string } | undefined
    await waitFor(
      async () => {
        found = (await settlementsOf(contractId)).find(
          (s) => s.status === 'PENDING',
        )
        return found !== undefined
      },
      { what: `liquidación pendiente del contrato ${contractId}` },
    )
    if (!found) throw new Error('sin pendiente')
    return found.id
  }

  const detail = async (id: string, token = adminToken) =>
    (await api(token).get(`/settlements/${id}`).expect(200)).body.data

  const transfer = (
    settlementId: string,
    fields: Record<string, string>,
    options: { token?: string; file?: Buffer } = {},
  ) => {
    const req = api(options.token ?? adminToken).post(
      `/settlements/${settlementId}/transfers`,
    )
    for (const [key, value] of Object.entries({
      transferredAt: today,
      method: 'TRANSFER',
      ...fields,
    })) {
      req.field(key, value)
    }
    if (options.file) {
      req.attach('file', options.file, {
        filename: 'comprobante.pdf',
        contentType: 'application/pdf',
      })
    }
    return req
  }

  beforeAll(async () => {
    await prisma.$connect()
    app = await createTestApp()
    // Los eventos se observan espiando `publish` y no con un `consume` propio:
    // `notifications` ya consume estas dos colas en la misma app y, en pg-boss,
    // cada mensaje lo toma UN solo worker. Un segundo consumidor competiría con
    // el real y el test se quedaba esperando un evento que nunca le llegaba.
    const queue = app.get(QueuePort)
    const realPublish = queue.publish.bind(queue)
    jest
      .spyOn(queue, 'publish')
      .mockImplementation(async (definition, payload, options) => {
        if (definition.name === SETTLEMENT_CONFIRMED_QUEUE.name) {
          confirmedEvents.push(payload as SettlementConfirmedPayload)
        }
        if (definition.name === STATEMENT_CLOSED_QUEUE.name) {
          closedEvents.push(payload as StatementClosedPayload)
        }
        return realPublish(definition, payload, options)
      })
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

  describe('liquidación individual (4.1 a 4.5)', () => {
    it('una cuota saldada crea la pendiente sola; recalcula con el siguiente pago; ajustes, confirmación y transferencias parciales hasta cubrir el neto', async () => {
      const contract = await createContract()
      const expenseId = await createExpense(contract.id, '1500')
      await createExpense(contract.id, '20', 'USD')
      const first = await payInstallment(contract.id, previous)

      // El listener de `installment-paid` dejó la pendiente.
      const id = await waitForDraft(contract.id)
      const draft = await detail(id)
      expect(draft).toMatchObject({
        period,
        sequence: 1,
        status: 'PENDING',
        contract: { id: contract.id },
        property: { id: contract.propertyId },
        owner: { id: contract.ownerId },
        renter: { id: contract.renterId },
        currency: 'ARS',
        rentTotal: '100000.00',
        lateFeeTotal: '0.00',
        ownerChargesTotal: '0.00',
        serviceChargesTotal: '0.00',
        feeMode: 'DEDUCTED',
        feePercentage: '5.00',
        feeAmountFixed: null,
        feeBase: '100000.00',
        feeTotal: '5000.00',
        feeDeducted: true,
        mixedFeeTerms: false,
        expensesTotal: '1500.00',
        adjustmentsTotal: '0.00',
        // 100.000 − 5.000 − 1.500
        netAmount: '93500.00',
        transferredTotal: '0.00',
        statementId: null,
        hasVoidedPayments: false,
        ownerBankAccountMissing: false,
        confirmedAt: null,
      })
      expect(draft.payments).toHaveLength(1)
      expect(draft.payments[0]).toMatchObject({
        paymentId: first.paymentId,
        installmentId: first.installmentId,
        installmentPeriod: previous,
        rentApplied: '100000.00',
      })
      expect(draft.expenses).toEqual([
        expect.objectContaining({
          expenseId,
          amount: '1500.00',
          currency: 'ARS',
        }),
      ])
      expect(draft.skippedExpenses).toEqual([
        expect.objectContaining({ amount: '20.00', currency: 'USD' }),
      ])

      // Una sola pendiente por contrato.
      const twice = await api(adminToken)
        .post('/settlements')
        .send({ contractId: contract.id })
        .expect(409)
      expect(twice.body.code).toBe('SETTLEMENT_DRAFT_EXISTS')

      // Otra cuota saldada (con un cargo del propietario y uno de servicio)
      // recalcula la misma pendiente.
      await generate(period)
      const second = await installmentOf(contract.id, period)
      await api(adminToken)
        .post(`/billing/installments/${second.id}/charges`)
        .send({ concept: 'OTHER', description: 'Llave', amount: '2000' })
        .expect(201)
      await api(adminToken)
        .post(`/billing/installments/${second.id}/charges`)
        .send({ concept: 'SERVICE', description: 'Expensas', amount: '3000' })
        .expect(201)
      await pay(second.id, { paidAt: today, amount: '105000' }).expect(201)
      await waitFor(async () => (await detail(id)).rentTotal === '200000.00')
      expect(await detail(id)).toMatchObject({
        rentTotal: '200000.00',
        ownerChargesTotal: '2000.00',
        serviceChargesTotal: '3000.00',
        feeTotal: '10000.00',
        // 200.000 + 2.000 − 10.000 − 1.500 (los 3.000 de SERVICE no entran, A-16)
        netAmount: '190500.00',
      })

      // Ajustes manuales (A-20): retención resta, crédito suma; se anulan.
      const withheld = await api(employeeToken)
        .post(`/settlements/${id}/adjustments`)
        .send({
          concept: 'WITHHOLDING',
          description: 'Retención IIBB',
          amount: '500',
        })
        .expect(201)
      expect(withheld.body.data).toMatchObject({
        adjustmentsTotal: '-500.00',
        netAmount: '190000.00',
      })
      const credited = await api(adminToken)
        .post(`/settlements/${id}/adjustments`)
        .send({ concept: 'OTHER_CREDIT', description: 'Bonif.', amount: '100' })
        .expect(201)
      expect(credited.body.data).toMatchObject({
        adjustmentsTotal: '-400.00',
        netAmount: '190100.00',
      })
      const creditId = credited.body.data.adjustments[1].id as string
      const voided = await api(adminToken)
        .post(`/settlements/adjustments/${creditId}/void`)
        .send({ reason: 'Cargado por error' })
        .expect(200)
      expect(voided.body.data).toMatchObject({
        adjustmentsTotal: '-500.00',
        netAmount: '190000.00',
      })
      expect(voided.body.data.adjustments[1]).toMatchObject({
        voidReason: 'Cargado por error',
        createdBy: { fullName: 'admin@a.com' },
      })
      const bad = await api(adminToken)
        .post(`/settlements/${id}/adjustments`)
        .send({ concept: 'WITHHOLDING', description: 'x', amount: '0' })
        .expect(400)
      expect(bad.body.code).toBe('SETTLEMENT_INVALID_AMOUNT')

      // Antes de confirmar no se transfiere.
      const early = await transfer(id, { amount: '1' }).expect(409)
      expect(early.body.code).toBe('SETTLEMENT_NOT_CONFIRMED')

      // Confirmar: marca pagos y gastos, emite el evento, queda inmutable.
      const confirmed = await api(employeeToken)
        .post(`/settlements/${id}/confirm`)
        .expect(200)
      expect(confirmed.body.data).toMatchObject({
        status: 'CONFIRMED',
        confirmedBy: { fullName: 'emp@a.com' },
        netAmount: '190000.00',
      })
      expect(confirmed.body.data.confirmedAt).not.toBeNull()
      const installment = await api(adminToken)
        .get(`/billing/installments/${first.installmentId}`)
        .expect(200)
      expect(installment.body.data.payments[0].settlementId).toBe(id)
      const expenses = await api(adminToken)
        .get(`/contracts/${contract.id}/advance-expenses?settled=true`)
        .expect(200)
      expect(expenses.body.data.items.map((e: { id: string }) => e.id)).toEqual(
        [expenseId],
      )
      expect(expenses.body.data.items[0].settlementId).toBe(id)
      await waitFor(() => confirmedEvents.some((e) => e.settlementId === id), {
        what: `evento settlement-confirmed de la liquidación ${id}`,
      })
      expect(confirmedEvents.find((e) => e.settlementId === id)).toEqual({
        settlementId: id,
        ownerId: contract.ownerId,
        contractId: contract.id,
        period,
        netAmount: '190000.00',
        currency: 'ARS',
      })
      for (const action of ['recalculate', 'confirm']) {
        const frozen = await api(adminToken)
          .post(`/settlements/${id}/${action}`)
          .expect(409)
        expect(frozen.body.code).toBe('SETTLEMENT_NOT_PENDING')
      }
      const noAdjust = await api(adminToken)
        .post(`/settlements/${id}/adjustments`)
        .send({ concept: 'WITHHOLDING', description: 'x', amount: '1' })
        .expect(409)
      expect(noAdjust.body.code).toBe('SETTLEMENT_NOT_PENDING')
      const noCancel = await api(adminToken)
        .post(`/settlements/${id}/cancel`)
        .send({ reason: 'x' })
        .expect(409)
      expect(noCancel.body.code).toBe('SETTLEMENT_NOT_PENDING')

      // Transferencias: parcial, exceso rechazado, total → TRANSFERRED.
      const partial = await transfer(
        id,
        { amount: '90000', notes: 'Primera parte' },
        { token: employeeToken, file: PDF },
      ).expect(201)
      expect(partial.body.data).toMatchObject({
        status: 'CONFIRMED',
        transferredTotal: '90000.00',
      })
      expect(partial.body.data.transfers[0]).toMatchObject({
        amount: '90000.00',
        method: 'TRANSFER',
        notes: 'Primera parte',
        registeredBy: { fullName: 'emp@a.com' },
        voidedAt: null,
      })
      expect(partial.body.data.transfers[0].receiptUrl).toContain(
        'settlements/',
      )
      const tooMuch = await transfer(id, { amount: '100000.01' }).expect(400)
      expect(tooMuch.body.code).toBe('SETTLEMENT_TRANSFER_EXCEEDS_NET')
      const future = await transfer(id, {
        amount: '1',
        transferredAt: addDays(today, 1),
      }).expect(400)
      expect(future.body.code).toBe('SETTLEMENT_INVALID_DATE')
      const badFile = await transfer(
        id,
        { amount: '1' },
        { file: Buffer.from('no soy un pdf') },
      ).expect(400)
      expect(badFile.body.code).toBe('SETTLEMENT_INVALID_RECEIPT')
      const rest = await transfer(id, {
        amount: '100000',
        method: 'CASH',
      }).expect(201)
      expect(rest.body.data).toMatchObject({
        status: 'TRANSFERRED',
        transferredTotal: '190000.00',
      })

      // Anular una transferencia es de admin y vuelve a CONFIRMED (A-18).
      const transferId = rest.body.data.transfers[1].id as string
      await api(employeeToken)
        .post(`/settlements/transfers/${transferId}/void`)
        .send({ reason: 'x' })
        .expect(403)
      const unvoided = await api(adminToken)
        .post(`/settlements/transfers/${transferId}/void`)
        .send({ reason: 'Rebotó' })
        .expect(200)
      expect(unvoided.body.data).toMatchObject({
        status: 'CONFIRMED',
        transferredTotal: '90000.00',
      })
      expect(unvoided.body.data.transfers[1].voidedAt).not.toBeNull()
      const again = await api(adminToken)
        .post(`/settlements/transfers/${transferId}/void`)
        .send({ reason: 'otra' })
        .expect(409)
      expect(again.body.code).toBe('SETTLEMENT_TRANSFER_ALREADY_VOIDED')

      // Listados.
      const list = await api(adminToken)
        .get(`/settlements?ownerId=${contract.ownerId}&status=CONFIRMED`)
        .expect(200)
      expect(list.body.data.pagination.total).toBe(1)
      expect(list.body.data.data[0]).toMatchObject({ id, period, sequence: 1 })
      const byOwner = await api(adminToken)
        .get(`/owners/${contract.ownerId}/settlements`)
        .expect(200)
      expect(byOwner.body.data.data.map((s: { id: string }) => s.id)).toEqual([
        id,
      ])
      await api(adminToken).get(`/settlements/${UNKNOWN_ID}`).expect(404)
    })

    it('sin pagos ni gastos no hay nada que liquidar; cobro directo del propietario no crea pendiente; cancelar (admin) libera los pagos', async () => {
      const empty = await createContract()
      const nothing = await api(adminToken)
        .post('/settlements')
        .send({ contractId: empty.id })
        .expect(409)
      expect(nothing.body.code).toBe('SETTLEMENT_NOTHING_TO_SETTLE')
      const missing = await api(adminToken)
        .post('/settlements')
        .send({ contractId: UNKNOWN_ID })
        .expect(422)
      expect(missing.body.code).toBe('SETTLEMENT_INVALID_CONTRACT')

      // Modalidad B: la cuota se salda con plata que recibió el propietario.
      const direct = await createContract({
        collectionMode: 'OWNER_DIRECT',
        feeMode: 'OWNER_PAYS',
      })
      await payInstallment(direct.id, previous)
      // Darle tiempo al listener: no debe crear nada.
      await new Promise((resolve) => setTimeout(resolve, 1500))
      expect(await settlementsOf(direct.id)).toEqual([])

      // Confirmar y cancelar a la vez: gana una sola. Antes el estado se
      // chequeaba fuera de la transacción y el UPDATE final no lo miraba, y la
      // liquidación podía quedar CONFIRMED con las líneas ya soltadas.
      const racing = await createContract()
      await payInstallment(racing.id, previous)
      const racingId = await waitForDraft(racing.id)
      const [confirmRace, cancelRace] = await Promise.all([
        api(adminToken).post(`/settlements/${racingId}/confirm`),
        api(adminToken)
          .post(`/settlements/${racingId}/cancel`)
          .send({ reason: 'a la vez' }),
      ])
      expect([confirmRace.status, cancelRace.status].sort()).toEqual([200, 409])
      const loser = confirmRace.status === 409 ? confirmRace : cancelRace
      expect(loser.body.code).toBe('SETTLEMENT_NOT_PENDING')
      const raced = await api(adminToken)
        .get(`/settlements/${racingId}`)
        .expect(200)
      expect(raced.body.data.status).toBe(
        confirmRace.status === 200 ? 'CONFIRMED' : 'CANCELLED',
      )
      if (confirmRace.status === 200) {
        expect(raced.body.data.payments.length).toBeGreaterThan(0)
      }

      // Cancelar libera los pagos para una liquidación nueva (secuencia 2).
      const contract = await createContract()
      await payInstallment(contract.id, previous)
      const id = await waitForDraft(contract.id)
      await api(employeeToken)
        .post(`/settlements/${id}/cancel`)
        .send({ reason: 'x' })
        .expect(403)
      const cancelled = await api(adminToken)
        .post(`/settlements/${id}/cancel`)
        .send({ reason: 'Se liquida el mes que viene' })
        .expect(200)
      expect(cancelled.body.data).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Se liquida el mes que viene',
        rentTotal: '100000.00',
        payments: [],
      })
      expect(cancelled.body.data.cancelledAt).not.toBeNull()
      const recreated = await api(adminToken)
        .post('/settlements')
        .send({ contractId: contract.id, period: '2026-12' })
        .expect(201)
      expect(recreated.body.data).toMatchObject({
        period: '2026-12',
        sequence: 1,
        rentTotal: '100000.00',
      })
      const sameMonth = await api(adminToken)
        .post('/settlements')
        .send({ contractId: contract.id, period: period })
        .expect(409)
      expect(sameMonth.body.code).toBe('SETTLEMENT_DRAFT_EXISTS')
      await api(adminToken)
        .post('/settlements')
        .send({ contractId: contract.id, period: '2026-13' })
        .expect(400)
    })

    it('un pago anulado después de confirmar no toca la liquidación: la marca y descuenta la diferencia en la siguiente pendiente (A-19)', async () => {
      const contract = await createContract()
      const { paymentId } = await payInstallment(contract.id, previous)
      const id = await waitForDraft(contract.id)
      await api(adminToken).post(`/settlements/${id}/confirm`).expect(200)

      await api(adminToken)
        .post(`/billing/payments/${paymentId}/void`)
        .send({ reason: 'Transferencia rechazada' })
        .expect(200)

      await waitFor(async () => (await detail(id)).hasVoidedPayments === true)
      expect(await detail(id)).toMatchObject({
        status: 'CONFIRMED',
        rentTotal: '100000.00',
        netAmount: '95000.00',
        hasVoidedPayments: true,
      })
      const next = (await settlementsOf(contract.id)).find(
        (s) => s.status === 'PENDING',
      )
      expect(next).toBeDefined()
      const draft = await detail(next!.id)
      expect(draft).toMatchObject({
        sequence: 2,
        rentTotal: '0.00',
        adjustmentsTotal: '-100000.00',
        netAmount: '-100000.00',
      })
      expect(draft.adjustments).toHaveLength(1)
      expect(draft.adjustments[0]).toMatchObject({
        concept: 'OTHER_DEDUCTION',
        amount: '100000.00',
        createdBy: null,
      })
      expect(draft.adjustments[0].description).toContain(
        'Transferencia rechazada',
      )
      // Un neto negativo se confirma pero no se transfiere.
      await api(adminToken).post(`/settlements/${next!.id}/confirm`).expect(200)
      const noTransfer = await transfer(next!.id, { amount: '1' }).expect(400)
      expect(noTransfer.body.code).toBe('SETTLEMENT_TRANSFER_EXCEEDS_NET')
    })

    it('con honorarios a cargo del propietario no se descuentan y al confirmar nace el honorario a cobrar; el fijo se prorratea (A-15)', async () => {
      const contract = await createContract({
        feeMode: 'RENTER_PAYS_ON_BEHALF',
        feeAmount: '8000',
      })
      // Pago parcial: 40 % del alquiler → 40 % del fijo.
      await generate(previous)
      const installment = await installmentOf(contract.id, previous)
      await pay(installment.id, { paidAt: day(5), amount: '40000' }).expect(201)
      const created = await api(adminToken)
        .post('/settlements')
        .send({ contractId: contract.id })
        .expect(201)
      expect(created.body.data).toMatchObject({
        rentTotal: '40000.00',
        feeMode: 'RENTER_PAYS_ON_BEHALF',
        feeAmountFixed: '8000.00',
        feeTotal: '3200.00',
        feeDeducted: false,
        netAmount: '40000.00',
      })
      const id = created.body.data.id as string
      await api(adminToken).post(`/settlements/${id}/confirm`).expect(200)
      const receivable = await prisma.feeReceivable.findFirstOrThrow({
        where: { tenantId: tenantA.id, originSettlementId: id },
      })
      expect(receivable).toMatchObject({
        ownerId: contract.ownerId,
        contractId: contract.id,
        source: 'SETTLEMENT_NOT_DEDUCTED',
        payer: 'RENTER',
        status: 'PENDING',
        period,
      })
      expect(receivable.amount.toFixed(2)).toBe('3200.00')
      expect(receivable.feeAmountFixed?.toFixed(2)).toBe('8000.00')
    })
  })

  describe('consolidado mensual por propietario (4.7, Micaela #7)', () => {
    /** Confirma la pendiente que dejó el listener y devuelve su id. */
    const settleAndConfirm = async (contractId: string) => {
      const id = await waitForDraft(contractId)
      await api(adminToken).post(`/settlements/${id}/confirm`).expect(200)
      return id
    }

    it('se arma a mano con liquidaciones confirmadas del propietario, se cierra con totales congelados y modo de envío, y se reabre (admin)', async () => {
      const ownerId = await createOwner()
      const first = await createContract({}, { ownerId })
      const second = await createContract(
        { currency: 'USD', initialRent: '1000', deposit: '1000' },
        { ownerId },
      )
      const pending = await createContract({}, { ownerId })
      const other = await createContract()
      await payInstallment(first.id, previous)
      await payInstallment(second.id, previous, '1000', undefined, {
        paidCurrency: 'USD',
      })
      await payInstallment(pending.id, previous)
      await payInstallment(other.id, previous)
      const firstId = await settleAndConfirm(first.id)
      const secondId = await settleAndConfirm(second.id)
      const pendingId = await waitForDraft(pending.id)
      const otherId = await settleAndConfirm(other.id)

      const missing = await api(adminToken)
        .post('/statements')
        .send({ ownerId: UNKNOWN_ID, period })
        .expect(422)
      expect(missing.body.code).toBe('STATEMENT_INVALID_OWNER')
      const created = await api(employeeToken)
        .post('/statements')
        .send({ ownerId, period })
        .expect(201)
      expect(created.body.data).toMatchObject({
        owner: { id: ownerId },
        period,
        status: 'OPEN',
        sendMode: 'BOTH',
        settlementsCount: 0,
        totals: [],
        settlements: [],
        closedAt: null,
        closedBy: null,
      })
      const id = created.body.data.id as string
      const taken = await api(adminToken)
        .post('/statements')
        .send({ ownerId, period })
        .expect(409)
      expect(taken.body.code).toBe('STATEMENT_PERIOD_TAKEN')

      const candidates = await api(adminToken)
        .get(`/statements/${id}/candidates`)
        .expect(200)
      expect(
        candidates.body.data.map((s: { id: string }) => s.id).sort(),
      ).toEqual([firstId, secondId].sort())

      const notConfirmed = await api(adminToken)
        .post(`/statements/${id}/settlements`)
        .send({ settlementIds: [pendingId] })
        .expect(409)
      expect(notConfirmed.body.code).toBe('SETTLEMENT_NOT_CONFIRMED')
      const mismatch = await api(adminToken)
        .post(`/statements/${id}/settlements`)
        .send({ settlementIds: [otherId] })
        .expect(422)
      expect(mismatch.body.code).toBe('SETTLEMENT_OWNER_MISMATCH')

      const added = await api(adminToken)
        .post(`/statements/${id}/settlements`)
        .send({ settlementIds: [firstId] })
        .expect(200)
      expect(added.body.data).toMatchObject({ settlementsCount: 1 })
      expect(added.body.data.totals).toEqual([
        {
          currency: 'ARS',
          rentTotal: '100000.00',
          lateFeeTotal: '0.00',
          chargesTotal: '0.00',
          feeTotal: '5000.00',
          expensesTotal: '0.00',
          adjustmentsTotal: '0.00',
          netTotal: '95000.00',
          transferredTotal: '0.00',
        },
      ])
      expect((await detail(firstId)).statementId).toBe(id)

      // Ya en otro consolidado → 409; en el mismo, idempotente.
      const another = await api(adminToken)
        .post('/statements')
        .send({ ownerId, period: '2030-01' })
        .expect(201)
      const inOther = await api(adminToken)
        .post(`/statements/${another.body.data.id}/settlements`)
        .send({ settlementIds: [firstId] })
        .expect(409)
      expect(inOther.body.code).toBe('SETTLEMENT_ALREADY_IN_STATEMENT')
      const again = await api(adminToken)
        .post(`/statements/${id}/settlements`)
        .send({ settlementIds: [firstId, secondId] })
        .expect(200)
      expect(again.body.data.settlementsCount).toBe(2)
      expect(
        again.body.data.totals.map((t: { currency: string }) => t.currency),
      ).toEqual(['ARS', 'USD'])

      const removed = await api(adminToken)
        .delete(`/statements/${id}/settlements/${secondId}`)
        .expect(200)
      expect(removed.body.data.settlementsCount).toBe(1)
      expect((await detail(secondId)).statementId).toBeNull()
      await api(adminToken)
        .delete(`/statements/${id}/settlements/${secondId}`)
        .expect(404)

      // Transferir parte antes de cerrar: el total transferido entra al consolidado.
      await transfer(firstId, { amount: '20000' }).expect(201)

      const closed = await api(employeeToken)
        .post(`/statements/${id}/close`)
        .send({ sendMode: 'SUMMARY' })
        .expect(200)
      expect(closed.body.data).toMatchObject({
        status: 'CLOSED',
        sendMode: 'SUMMARY',
        settlementsCount: 1,
        closedBy: { fullName: 'emp@a.com' },
      })
      expect(closed.body.data.closedAt).not.toBeNull()
      expect(closed.body.data.totals[0]).toMatchObject({
        currency: 'ARS',
        netTotal: '95000.00',
        transferredTotal: '20000.00',
      })
      expect(closed.body.data.settlements[0]).toMatchObject({
        id: firstId,
        transferredTotal: '20000.00',
      })
      await waitFor(() => closedEvents.some((e) => e.statementId === id), {
        what: `evento statement-closed del consolidado ${id}`,
      })
      expect(closedEvents.find((e) => e.statementId === id)).toEqual({
        statementId: id,
        ownerId,
        period,
        sendMode: 'SUMMARY',
        // D-229: las liquidaciones del consolidado viajan en el evento.
        settlements: [
          expect.objectContaining({ settlementId: firstId, ownerId }),
        ],
      })

      // Cerrado: congelado. Una transferencia nueva no lo cambia.
      await transfer(firstId, { amount: '75000' }).expect(201)
      const frozen = await api(adminToken).get(`/statements/${id}`).expect(200)
      expect(frozen.body.data.totals[0].transferredTotal).toBe('20000.00')
      const notOpen = await api(adminToken)
        .post(`/statements/${id}/settlements`)
        .send({ settlementIds: [secondId] })
        .expect(409)
      expect(notOpen.body.code).toBe('STATEMENT_NOT_OPEN')
      const twice = await api(adminToken)
        .post(`/statements/${id}/close`)
        .send({})
        .expect(409)
      expect(twice.body.code).toBe('STATEMENT_NOT_OPEN')

      await api(employeeToken).post(`/statements/${id}/reopen`).expect(403)
      const reopened = await api(adminToken)
        .post(`/statements/${id}/reopen`)
        .expect(200)
      expect(reopened.body.data).toMatchObject({
        status: 'OPEN',
        closedAt: null,
        closedBy: null,
      })
      // Abierto, los totales vuelven a estar en vivo.
      expect(reopened.body.data.totals[0].transferredTotal).toBe('95000.00')
      const notClosed = await api(adminToken)
        .post(`/statements/${id}/reopen`)
        .expect(409)
      expect(notClosed.body.code).toBe('STATEMENT_NOT_CLOSED')

      const list = await api(adminToken)
        .get(`/statements?ownerId=${ownerId}&status=OPEN`)
        .expect(200)
      expect(list.body.data.pagination.total).toBe(2)
      await api(adminToken).get(`/statements/${UNKNOWN_ID}`).expect(404)

      const facade = app.get(SettlementsFacade)
      const byOwner = await inTenantA(() => facade.statementsByOwner(ownerId))
      expect(byOwner).toHaveLength(2)
      const pdf = await inTenantA(() => facade.statementForPdf(id))
      expect(pdf?.settlements[0].owner?.id).toBe(ownerId)
      const history = await inTenantA(() => facade.listByOwner(ownerId))
      expect(history).toHaveLength(3)
    })
  })

  describe('cuenta de honorarios (4.8, Micaela #9B y #10)', () => {
    it('un alquiler cobrado por el propietario devenga el honorario al confirmarse; los pagos se imputan a los más viejos y el exceso espera al siguiente', async () => {
      const contract = await createContract({
        collectionMode: 'OWNER_DIRECT',
        feeMode: 'OWNER_PAYS',
      })
      const ownerId = contract.ownerId
      // Punitorios en la base (Micaela #5), para ver que la regla del propietario manda.
      await api(adminToken)
        .patch(`/owners/${ownerId}/fee-settings`)
        .send({ feeIncludesLateFees: true })
        .expect(200)

      await generate(previous)
      const installment = await installmentOf(contract.id, previous)
      const informed = await pay(installment.id, {
        paidAt: day(5),
        amount: '100000',
      }).expect(201)
      const paymentId = informed.body.data.payment.id as string
      expect(informed.body.data.payment.status).toBe('PENDING_CONFIRMATION')

      // Informado no devenga; confirmado sí.
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const before = await api(adminToken)
        .get(`/owners/${ownerId}/fee-account`)
        .expect(200)
      expect(before.body.data).toMatchObject({
        ownerId,
        totals: [],
        receivables: [],
        payments: [],
        movements: [],
      })
      await api(adminToken)
        .post(`/billing/payments/${paymentId}/confirm`)
        .expect(200)
      await waitFor(
        async () =>
          (
            await api(adminToken)
              .get(`/fee-receivables?ownerId=${ownerId}`)
              .expect(200)
          ).body.data.pagination.total === 1,
      )
      const receivables = await api(adminToken)
        .get(`/fee-receivables?ownerId=${ownerId}&status=PENDING`)
        .expect(200)
      const receivable = receivables.body.data.data[0]
      expect(receivable).toMatchObject({
        owner: { id: ownerId },
        contract: { id: contract.id },
        property: { id: contract.propertyId },
        installmentPeriod: previous,
        currency: 'ARS',
        source: 'OWNER_DIRECT_PAYMENT',
        payer: 'OWNER',
        amount: '5000.00',
        paidAmount: '0.00',
        status: 'PENDING',
        feePercentage: '5.00',
        feeAmountFixed: null,
        baseAmount: '100000.00',
        needsReview: false,
      })
      const account = await api(adminToken)
        .get(`/owners/${ownerId}/fee-account`)
        .expect(200)
      expect(account.body.data.totals).toEqual([
        {
          currency: 'ARS',
          accrued: '5000.00',
          collected: '0.00',
          pending: '5000.00',
          unallocated: '0.00',
        },
      ])

      // Pago parcial del propietario, con comprobante.
      const feePay = (fields: Record<string, string>, token = adminToken) => {
        const req = api(token).post('/fee-payments')
        for (const [key, value] of Object.entries({
          ownerId,
          paidAt: today,
          currency: 'ARS',
          method: 'TRANSFER',
          paidBy: 'OWNER',
          ...fields,
        })) {
          req.field(key, value)
        }
        return req.attach('file', PDF, {
          filename: 'comprobante.pdf',
          contentType: 'application/pdf',
        })
      }
      const partial = await feePay({ amount: '3000' }, employeeToken).expect(
        201,
      )
      expect(partial.body.data).toMatchObject({
        ownerId,
        contractId: null,
        paidAt: today,
        amount: '3000.00',
        currency: 'ARS',
        method: 'TRANSFER',
        paidBy: 'OWNER',
        unallocatedAmount: '0.00',
        registeredBy: { fullName: 'emp@a.com' },
        voidedAt: null,
        allocations: [{ feeReceivableId: receivable.id, amount: '3000.00' }],
      })
      expect(partial.body.data.receiptUrl).toContain('fee-payments/')
      const bad = await feePay({ amount: '0' }).expect(400)
      expect(bad.body.code).toBe('FEE_PAYMENT_INVALID_AMOUNT')
      const badOwner = await feePay({
        ownerId: UNKNOWN_ID,
        amount: '1',
      }).expect(422)
      expect(badOwner.body.code).toBe('FEE_PAYMENT_INVALID_OWNER')
      const badContract = await feePay({
        contractId: UNKNOWN_ID,
        amount: '1',
      }).expect(422)
      expect(badContract.body.code).toBe('FEE_PAYMENT_INVALID_CONTRACT')

      // Cubre el resto y sobran 2.000 sin imputar.
      const rest = await feePay({ amount: '4000', paidBy: 'RENTER' }).expect(
        201,
      )
      expect(rest.body.data).toMatchObject({
        unallocatedAmount: '2000.00',
        allocations: [{ feeReceivableId: receivable.id, amount: '2000.00' }],
      })
      const paid = await api(adminToken)
        .get(`/fee-receivables?ownerId=${ownerId}&status=PAID`)
        .expect(200)
      expect(paid.body.data.data[0]).toMatchObject({
        id: receivable.id,
        paidAmount: '5000.00',
      })
      const afterPayments = await api(adminToken)
        .get(`/owners/${ownerId}/fee-account`)
        .expect(200)
      expect(afterPayments.body.data.totals[0]).toEqual({
        currency: 'ARS',
        accrued: '5000.00',
        collected: '5000.00',
        pending: '0.00',
        unallocated: '2000.00',
      })
      expect(
        afterPayments.body.data.movements.map(
          (m: { type: string; balance: string }) => [m.type, m.balance],
        ),
      ).toEqual([
        ['ACCRUED', '5000.00'],
        ['PAYMENT', '2000.00'],
        ['PAYMENT', '-2000.00'],
      ])

      // El próximo honorario devengado toma solo los 2.000 que sobraban.
      await generate(period)
      const next = await installmentOf(contract.id, period)
      const nextPaid = await pay(next.id, {
        paidAt: today,
        amount: '100000',
      }).expect(201)
      await api(adminToken)
        .post(`/billing/payments/${nextPaid.body.data.payment.id}/confirm`)
        .expect(200)
      await waitFor(
        async () =>
          (
            await api(adminToken)
              .get(`/fee-receivables?ownerId=${ownerId}&status=PARTIAL`)
              .expect(200)
          ).body.data.pagination.total === 1,
      )
      const second = (
        await api(adminToken)
          .get(`/fee-receivables?ownerId=${ownerId}&status=PARTIAL`)
          .expect(200)
      ).body.data.data[0]
      expect(second).toMatchObject({
        installmentPeriod: period,
        amount: '5000.00',
        paidAmount: '2000.00',
      })
      const restPayment = await api(adminToken)
        .get(`/owners/${ownerId}/fee-account`)
        .expect(200)
      const restView = restPayment.body.data.payments.find(
        (p: { id: string }) => p.id === rest.body.data.id,
      )
      expect(restView).toMatchObject({ unallocatedAmount: '0.00' })
      expect(restView.allocations).toHaveLength(2)

      // Anular el segundo pago (admin) devuelve ambos receivables a lo que debían.
      await api(employeeToken)
        .post(`/fee-payments/${rest.body.data.id}/void`)
        .send({ reason: 'x' })
        .expect(403)
      const voided = await api(adminToken)
        .post(`/fee-payments/${rest.body.data.id}/void`)
        .send({ reason: 'Rebotó' })
        .expect(200)
      expect(voided.body.data).toMatchObject({
        voidReason: 'Rebotó',
        unallocatedAmount: '0.00',
      })
      expect(voided.body.data.voidedAt).not.toBeNull()
      const twice = await api(adminToken)
        .post(`/fee-payments/${rest.body.data.id}/void`)
        .send({ reason: 'otra' })
        .expect(409)
      expect(twice.body.code).toBe('FEE_PAYMENT_ALREADY_VOIDED')
      const afterVoid = await api(adminToken)
        .get(`/owners/${ownerId}/fee-account`)
        .expect(200)
      expect(afterVoid.body.data.totals[0]).toEqual({
        currency: 'ARS',
        accrued: '10000.00',
        collected: '3000.00',
        pending: '7000.00',
        unallocated: '0.00',
      })
      expect(
        afterVoid.body.data.receivables.map(
          (r: { status: string; paidAmount: string }) => [
            r.status,
            r.paidAmount,
          ],
        ),
      ).toEqual([
        ['PENDING', '0.00'],
        ['PARTIAL', '3000.00'],
      ])

      // Un pago con saldo sin imputar se aplica a mano cuando hay pendientes.
      const big = await feePay({ amount: '20000' }).expect(201)
      expect(big.body.data.unallocatedAmount).toBe('13000.00')
      const allocated = await api(adminToken)
        .post(`/fee-payments/${big.body.data.id}/allocate`)
        .expect(200)
      expect(allocated.body.data.unallocatedAmount).toBe('13000.00')

      // Anular el pago del inquilino que originó el segundo honorario: ya
      // tiene cobros, así que queda para revisión en vez de anularse.
      await api(adminToken)
        .post(`/billing/payments/${nextPaid.body.data.payment.id}/void`)
        .send({ reason: 'Error de carga' })
        .expect(200)
      await waitFor(async () =>
        (
          await api(adminToken).get(`/fee-receivables?ownerId=${ownerId}`)
        ).body.data.data.some((r: { needsReview: boolean }) => r.needsReview),
      )

      const facade = app.get(SettlementsFacade)
      expect(await inTenantA(() => facade.feeAccountSummary(ownerId))).toEqual([
        {
          currency: 'ARS',
          accrued: '10000.00',
          collected: '10000.00',
          pending: '0.00',
          unallocated: '13000.00',
        },
      ])
      await api(adminToken).get(`/owners/${UNKNOWN_ID}/fee-account`).expect(422)
    })

    it('un honorario sin cobros se anula cuando se anula el pago que lo generó', async () => {
      const contract = await createContract({
        collectionMode: 'OWNER_DIRECT',
        feeMode: 'OWNER_PAYS',
      })
      await generate(previous)
      const installment = await installmentOf(contract.id, previous)
      const informed = await pay(installment.id, {
        paidAt: day(5),
        amount: '100000',
      }).expect(201)
      const paymentId = informed.body.data.payment.id as string
      await api(adminToken)
        .post(`/billing/payments/${paymentId}/confirm`)
        .expect(200)
      await waitFor(
        async () =>
          (
            await api(adminToken).get(
              `/fee-receivables?contractId=${contract.id}`,
            )
          ).body.data.pagination.total === 1,
      )
      await api(adminToken)
        .post(`/billing/payments/${paymentId}/void`)
        .send({ reason: 'Nunca llegó' })
        .expect(200)
      await waitFor(
        async () =>
          (
            await api(adminToken).get(
              `/fee-receivables?contractId=${contract.id}&status=VOIDED`,
            )
          ).body.data.pagination.total === 1,
      )
      const account = await api(adminToken)
        .get(`/owners/${contract.ownerId}/fee-account`)
        .expect(200)
      expect(account.body.data.totals[0]).toMatchObject({
        accrued: '0.00',
        pending: '0.00',
      })
      expect(
        account.body.data.movements.map((m: { type: string }) => m.type),
      ).toEqual(['ACCRUED', 'RECEIVABLE_VOIDED'])
    })
  })

  describe('aislamiento entre inmobiliarias', () => {
    it('otra inmobiliaria no ve consolidados ni la cuenta de honorarios ajenos', async () => {
      const contract = await createContract()
      const created = await api(adminToken)
        .post('/statements')
        .send({ ownerId: contract.ownerId, period })
        .expect(201)
      const b = api(adminBToken)
      await b.get(`/statements/${created.body.data.id}`).expect(404)
      await b
        .post(`/statements/${created.body.data.id}/close`)
        .send({})
        .expect(404)
      const foreignOwner = await b
        .post('/statements')
        .send({ ownerId: contract.ownerId, period })
        .expect(422)
      expect(foreignOwner.body.code).toBe('STATEMENT_INVALID_OWNER')
      await b.get(`/owners/${contract.ownerId}/fee-account`).expect(422)
      const list = await b.get('/statements').expect(200)
      expect(list.body.data.pagination.total).toBe(0)
      const receivables = await b.get('/fee-receivables').expect(200)
      expect(receivables.body.data.pagination.total).toBe(0)
    })

    it('otra inmobiliaria no ve, no crea, no ajusta ni confirma liquidaciones ajenas', async () => {
      const contract = await createContract()
      await payInstallment(contract.id, previous)
      const id = await waitForDraft(contract.id)

      const b = api(adminBToken)
      const foreign = await b
        .post('/settlements')
        .send({ contractId: contract.id })
        .expect(422)
      expect(foreign.body.code).toBe('SETTLEMENT_INVALID_CONTRACT')
      await b.get(`/settlements/${id}`).expect(404)
      await b.post(`/settlements/${id}/recalculate`).expect(404)
      await b
        .post(`/settlements/${id}/adjustments`)
        .send({ concept: 'WITHHOLDING', description: 'x', amount: '1' })
        .expect(404)
      await b.post(`/settlements/${id}/confirm`).expect(404)
      await b
        .post(`/settlements/${id}/cancel`)
        .send({ reason: 'x' })
        .expect(404)
      await transfer(id, { amount: '1' }, { token: adminBToken }).expect(404)
      const list = await b.get('/settlements').expect(200)
      expect(list.body.data.pagination.total).toBe(0)
      const byOwner = await b
        .get(`/owners/${contract.ownerId}/settlements`)
        .expect(200)
      expect(byOwner.body.data.pagination.total).toBe(0)

      // La suya sí.
      const own = await createContract(
        {},
        { token: adminBToken, master: refsB },
      )
      await generate(previous, adminBToken)
      const installment = (
        await b
          .get(`/billing/installments?contractId=${own.id}&period=${previous}`)
          .expect(200)
      ).body.data.data[0]
      await pay(
        installment.id,
        { paidAt: day(5), amount: '100000' },
        adminBToken,
      ).expect(201)
      await waitFor(
        async () => (await settlementsOf(own.id, adminBToken)).length === 1,
      )
      expect(await settlementsOf(contract.id, adminBToken)).toEqual([])
    })
  })
})
