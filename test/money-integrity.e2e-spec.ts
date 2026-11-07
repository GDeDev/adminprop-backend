import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import request from 'supertest'

import { seedBaseMasterData } from '../prisma/lib/master-data-seed'
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

const today = todayIso()
/** El mes pasado: sus fechas ya pasaron, así los pagos se fechan sin mirar qué día es hoy. */
const previous = periodOf(addMonths(today, -1))
const day = (n: number, inPeriod = previous) =>
  `${inPeriod}-${String(n).padStart(2, '0')}`

/**
 * Integridad de la plata entre cobros y liquidaciones (revisión 2026-11-06,
 * informes 01 y 02). Cada caso reproduce un escenario del informe con sus
 * números: lo que se le transfiere al propietario tiene que ser lo que la
 * inmobiliaria efectivamente cobró, menos el honorario que corresponde.
 */
describe('Integridad de la plata (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenant: { id: string }
  let adminToken: string
  let refs: { tolosa: string; casa: string }

  const api = (token = adminToken) => ({
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
    const response = await api()
      .post('/owners')
      .send({ firstName: 'Juan', lastName: 'Pérez', nationalId: nextId() })
      .expect(201)
    return response.body.data.id
  }

  const createRenter = async (): Promise<string> => {
    const response = await api()
      .post('/renters')
      .send({ firstName: 'Iván', lastName: 'López', nationalId: nextId() })
      .expect(201)
    return response.body.data.id
  }

  /**
   * Contrato de 100.000 ARS, honorarios 5 % descontados, sin punitorio (gracia
   * larga) y cobro por la inmobiliaria, salvo overrides.
   */
  const createContract = async (
    overrides: Record<string, unknown> = {},
    options: { renterId?: string; ownerId?: string } = {},
  ) => {
    const ownerId = options.ownerId ?? (await createOwner())
    const property = await api()
      .post('/properties')
      .send({
        address: `Calle ${++counter}`,
        locationId: refs.tolosa,
        propertyTypeId: refs.casa,
        ownerId,
      })
      .expect(201)
    const renterId = options.renterId ?? (await createRenter())
    const response = await api()
      .post('/contracts')
      .send({
        propertyId: property.body.data.id,
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
    return { id: response.body.data.id as string, ownerId, renterId }
  }

  const generate = async (forPeriod: string) => {
    await api()
      .post('/billing/installments/generate')
      .send({ period: forPeriod })
      .expect(200)
  }

  const installmentOf = async (contractId: string, forPeriod = previous) => {
    const response = await api()
      .get(`/billing/installments?contractId=${contractId}&period=${forPeriod}`)
      .expect(200)
    return response.body.data.data[0] as { id: string; status: string }
  }

  const pay = (installmentId: string, fields: Record<string, string>) => {
    const req = api().post(`/billing/installments/${installmentId}/payments`)
    for (const [key, value] of Object.entries({
      paidCurrency: 'ARS',
      method: 'TRANSFER',
      paidAt: day(5),
      ...fields,
    })) {
      req.field(key, value)
    }
    return req
  }

  const voidPayment = (paymentId: string) =>
    api()
      .post(`/billing/payments/${paymentId}/void`)
      .send({ reason: 'Transferencia rechazada' })

  const createExpense = async (contractId: string, amount: string) => {
    const response = await api()
      .post(`/contracts/${contractId}/advance-expenses`)
      .field('amount', amount)
      .field('description', 'Plomero')
      .field('expenseDate', addDays(today, -3))
      .attach('file', PDF, {
        filename: 'ticket.pdf',
        contentType: 'application/pdf',
      })
      .expect(201)
    return response.body.data.id as string
  }

  const settlementsOf = async (contractId: string) =>
    (await api().get(`/settlements?contractId=${contractId}`).expect(200)).body
      .data.data as { id: string; status: string }[]

  const pendingOf = async (contractId: string) =>
    (await settlementsOf(contractId)).find((s) => s.status === 'PENDING')

  const waitForDraft = async (contractId: string) => {
    await waitFor(async () => (await pendingOf(contractId)) !== undefined, {
      what: `liquidación pendiente del contrato ${contractId}`,
    })
    const found = await pendingOf(contractId)
    if (!found) throw new Error('sin pendiente')
    return found.id
  }

  const detail = async (id: string) =>
    (await api().get(`/settlements/${id}`).expect(200)).body.data

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
    tenant = await createTenant(prisma, 'tenant-money')
    await seedBaseMasterData(prisma, tenant.id, { withSampleCities: true })
    await createUser(prisma, {
      tenantId: tenant.id,
      email: 'admin@money.com',
      role: Role.ADMIN,
    })
    adminToken = await loginAs(app, 'admin@money.com')
    refs = {
      tolosa: (
        await prisma.location.findFirstOrThrow({
          where: { tenantId: tenant.id, name: 'Tolosa' },
        })
      ).id,
      casa: (
        await prisma.propertyType.findFirstOrThrow({
          where: { tenantId: tenant.id, name: 'Casa' },
        })
      ).id,
    }
  })

  describe('crítico 1 / C1: la pendiente sigue a los pagos anulados y a los gastos corregidos', () => {
    it('un pago anulado mientras la liquidación está pendiente no se le transfiere al propietario', async () => {
      // Antes: la reacción a la anulación salía porque el pago no tenía
      // settlementId (una pendiente no lo marca), la pendiente quedaba con
      // neto 95.000 y al confirmarla se transferían por un pago anulado.
      const contract = await createContract()
      await generate(previous)
      const installment = await installmentOf(contract.id)
      const paid = await pay(installment.id, { amount: '100000' }).expect(201)
      const paymentId = paid.body.data.payment.id as string
      const id = await waitForDraft(contract.id)
      expect(await detail(id)).toMatchObject({
        rentTotal: '100000.00',
        feeTotal: '5000.00',
        netAmount: '95000.00',
      })

      await voidPayment(paymentId).expect(200)
      // Se confirma enseguida, sin esperar a la reacción: o la reacción ya la
      // recalculó (y se confirma vacía) o la confirmación la encuentra
      // desactualizada (409). Nunca se confirma con los 95.000.
      const first = await api().post(`/settlements/${id}/confirm`)
      if (first.status === 409) {
        expect(first.body.code).toBe('SETTLEMENT_STALE')
      } else {
        expect(first.status).toBe(200)
      }
      await waitFor(async () => (await detail(id)).payments.length === 0, {
        what: 'la pendiente sin el pago anulado',
      })
      if ((await detail(id)).status === 'PENDING') {
        await api().post(`/settlements/${id}/confirm`).expect(200)
      }
      expect(await detail(id)).toMatchObject({
        status: 'CONFIRMED',
        rentTotal: '0.00',
        feeTotal: '0.00',
        netAmount: '0.00',
      })
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { id: paymentId },
      })
      expect(payment.status).toBe('VOIDED')
      expect(payment.settlementId).toBeNull()
    })

    it('la reacción a la anulación recalcula la pendiente sola', async () => {
      const contract = await createContract()
      await generate(previous)
      const installment = await installmentOf(contract.id)
      const paid = await pay(installment.id, { amount: '100000' }).expect(201)
      const id = await waitForDraft(contract.id)

      await voidPayment(paid.body.data.payment.id).expect(200)

      await waitFor(async () => (await detail(id)).payments.length === 0, {
        what: 'la pendiente recalculada por la anulación',
      })
      expect(await detail(id)).toMatchObject({
        status: 'PENDING',
        rentTotal: '0.00',
        netAmount: '0.00',
      })
    })

    it('un gasto corregido después de armar la pendiente no se descuenta con el monto viejo', async () => {
      // Antes: el gasto de 50.000 corregido a 5.000 se seguía descontando
      // entero y el propietario cobraba 45.000 de menos.
      const contract = await createContract()
      const expenseId = await createExpense(contract.id, '50000')
      await generate(previous)
      const installment = await installmentOf(contract.id)
      await pay(installment.id, { amount: '100000' }).expect(201)
      const id = await waitForDraft(contract.id)
      expect(await detail(id)).toMatchObject({
        expensesTotal: '50000.00',
        netAmount: '45000.00',
      })

      await api()
        .patch(`/advance-expenses/${expenseId}`)
        .send({ amount: '5000' })
        .expect(200)

      const stale = await api().post(`/settlements/${id}/confirm`).expect(409)
      expect(stale.body.code).toBe('SETTLEMENT_STALE')
      // Quedó recalculada: el que la vuelve a abrir ve el monto nuevo.
      expect(await detail(id)).toMatchObject({
        status: 'PENDING',
        expensesTotal: '5000.00',
        netAmount: '90000.00',
      })
      await api().post(`/settlements/${id}/confirm`).expect(200)
      expect(await detail(id)).toMatchObject({
        status: 'CONFIRMED',
        netAmount: '90000.00',
      })
    })
  })

  describe('crítico 2: anular un pago ya liquidado revierte también su honorario (A-19, D-259)', () => {
    it('honorario descontado: el ajuste es el neto y, si el inquilino vuelve a pagar, la inmobiliaria cobra el honorario una sola vez', async () => {
      // Antes: el ajuste descontaba el bruto (100.000) y al volver a pagar la
      // pendiente quedaba en −5.000: el propietario terminaba con 90.000 y la
      // inmobiliaria con 10.000 de honorario por un solo mes.
      const contract = await createContract()
      await generate(previous)
      const installment = await installmentOf(contract.id)
      const paid = await pay(installment.id, { amount: '100000' }).expect(201)
      const first = await waitForDraft(contract.id)
      await api().post(`/settlements/${first}/confirm`).expect(200)
      expect(await detail(first)).toMatchObject({ netAmount: '95000.00' })

      await voidPayment(paid.body.data.payment.id).expect(200)
      await waitFor(
        async () => (await detail(first)).hasVoidedPayments === true,
        { what: 'la liquidación marcada con el pago anulado' },
      )
      const second = await waitForDraft(contract.id)
      await waitFor(async () => (await detail(second)).adjustments.length > 0, {
        what: 'el ajuste A-19 en la pendiente',
      })
      expect(await detail(second)).toMatchObject({
        adjustmentsTotal: '-95000.00',
        netAmount: '-95000.00',
      })

      // El inquilino vuelve a pagar.
      await pay(installment.id, { amount: '100000' }).expect(201)
      await waitFor(
        async () => (await detail(second)).rentTotal === '100000.00',
        { what: 'la pendiente con el pago nuevo' },
      )
      expect(await detail(second)).toMatchObject({
        rentTotal: '100000.00',
        feeTotal: '5000.00',
        adjustmentsTotal: '-95000.00',
        netAmount: '0.00',
      })
    })

    it('honorario a cargo del propietario (no descontado): el ajuste es el bruto y el honorario a cobrar se anula', async () => {
      // Antes: el receivable de 5.000 de la liquidación seguía vivo y el
      // propietario debía un honorario sobre un alquiler que nunca se cobró.
      const contract = await createContract({ feeMode: 'OWNER_PAYS' })
      await generate(previous)
      const installment = await installmentOf(contract.id)
      const paid = await pay(installment.id, { amount: '100000' }).expect(201)
      const first = await waitForDraft(contract.id)
      await api().post(`/settlements/${first}/confirm`).expect(200)
      const receivable = await prisma.feeReceivable.findFirstOrThrow({
        where: { originSettlementId: first },
      })
      expect(receivable.amount.toFixed(2)).toBe('5000.00')

      await voidPayment(paid.body.data.payment.id).expect(200)
      const second = await waitForDraft(contract.id)
      await waitFor(async () => (await detail(second)).adjustments.length > 0, {
        what: 'el ajuste A-19 en la pendiente',
      })
      expect(await detail(second)).toMatchObject({
        adjustmentsTotal: '-100000.00',
      })
      await waitFor(
        async () =>
          (
            await prisma.feeReceivable.findUniqueOrThrow({
              where: { id: receivable.id },
            })
          ).status === 'VOIDED',
        { what: 'el honorario a cobrar anulado' },
      )
    })
  })

  describe('crítico 3: un saldo a favor que tiene el propietario no se liquida como cobrado por la inmobiliaria', () => {
    it('cobro directo: el crédito nacido de un pago al propietario se aplica como cobrado por él y no arma liquidación', async () => {
      // Antes: el CREDIT_APPLICATION nacía "recibido por la inmobiliaria",
      // entraba a una pendiente con neto 47.500 y la inmobiliaria transfería
      // plata que nunca recibió (el propietario terminaba con 247.500).
      const contract = await createContract({ collectionMode: 'OWNER_DIRECT' })
      const current = periodOf(today)
      await generate(previous)
      const november = await installmentOf(contract.id, previous)
      const over = await pay(november.id, {
        amount: '150000',
        receivedBy: 'OWNER',
      }).expect(201)
      await api()
        .post(`/billing/payments/${over.body.data.payment.id}/confirm`)
        .expect(200)
      const credit = await prisma.renterCredit.findFirstOrThrow({
        where: { originPaymentId: over.body.data.payment.id },
      })
      expect(credit.amount.toFixed(2)).toBe('50000.00')
      expect(credit.heldBy).toBe('OWNER')

      await generate(current)
      const december = await installmentOf(contract.id, current)
      const second = await pay(december.id, {
        amount: '50000',
        receivedBy: 'OWNER',
        paidAt: today,
      }).expect(201)
      expect(second.body.data.creditApplications).toHaveLength(1)
      expect(second.body.data.creditApplications[0]).toMatchObject({
        kind: 'CREDIT_APPLICATION',
        receivedBy: 'OWNER',
        amountInContractCurrency: '50000.00',
      })
      await api()
        .post(`/billing/payments/${second.body.data.payment.id}/confirm`)
        .expect(200)

      // Los dos meses devengan honorario por cobro directo (5.000 + 2.500 +
      // 2.500) y no hay nada que la inmobiliaria tenga que transferir.
      await waitFor(
        async () =>
          (await prisma.feeReceivable.count({
            where: { contractId: contract.id },
          })) === 3,
        { what: 'los tres honorarios por cobro directo' },
      )
      const receivables = await prisma.feeReceivable.findMany({
        where: { contractId: contract.id },
      })
      expect(
        receivables.reduce((sum, r) => sum + Number(r.amount), 0).toFixed(2),
      ).toBe('10000.00')
      await new Promise((resolve) => setTimeout(resolve, 1500))
      expect(await settlementsOf(contract.id)).toHaveLength(0)
    })

    it('un saldo que tiene el propietario no se aplica a la cuota de otro contrato', async () => {
      // Un inquilino puede arrastrar un saldo de un contrato anterior con
      // cobro directo: ese saldo lo tiene aquel propietario, no la
      // inmobiliaria. Se arma directo en la base (un inquilino no puede tener
      // dos contratos activos a la vez).
      const other = await createContract()
      await prisma.renterCredit.create({
        data: {
          tenantId: tenant.id,
          renterId: other.renterId,
          contractId: '00000000-0000-4000-8000-0000000000aa',
          currency: 'ARS',
          amount: '30000',
          remaining: '30000',
          originPaymentId: '00000000-0000-4000-8000-0000000000bb',
          heldBy: 'OWNER',
        },
      })
      await generate(previous)
      const foreign = await installmentOf(other.id, previous)
      const response = await api()
        .post(`/billing/installments/${foreign.id}/apply-credit`)
        .send({})
      expect(response.status).toBe(409)
      expect(response.body.code).toBe('CREDIT_NOT_AVAILABLE')
    })
  })
})
