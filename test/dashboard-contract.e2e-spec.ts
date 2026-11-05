import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import request from 'supertest'

import { BillingFacade } from '../src/modules/billing/public'
import { buildHistory } from '../src/modules/reports/application/report-builders'
import { lastPeriods } from '../src/modules/reports/domain/report-calculations'
import { RequestContext } from '../src/shared/context/request-context'
import { addDays, periodOf, todayIso } from '../src/shared/dates/calendar-date'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'

const today = todayIso()
const current = periodOf(today)
const HISTORY = 6
const periods = lastPeriods(current, HISTORY)
const UUID = '5d1b0000-0000-4000-8000-0000000000'
const id = (n: number) => `${UUID}${String(n).padStart(2, '0')}`

/**
 * Contrato de salida del dashboard (auditoría de datos, A5). Los números de
 * `history` salen de agregaciones en la base y no de hidratar cada cuota:
 * este test fija el resultado con un conjunto de datos conocido, y lo compara
 * contra el camino viejo (traer todas las cuotas con sus pagos y sumar en
 * memoria) para que los dos no se separen.
 */
describe('Contrato del dashboard (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenant: { id: string }
  let adminToken: string

  let seq = 0
  const installment = (data: {
    period: string
    baseAmount: string
    currency?: 'ARS' | 'USD'
    status?: 'PENDING' | 'PARTIAL' | 'PAID'
    graceEndDate?: string
    tenantId?: string
  }) =>
    prisma.installment.create({
      data: {
        tenantId: data.tenantId ?? tenant.id,
        contractId: id(++seq),
        renterId: id(90),
        ownerId: id(91),
        propertyId: id(92),
        period: data.period,
        baseAmount: data.baseAmount,
        currency: data.currency ?? 'ARS',
        graceEndDate: new Date(
          `${data.graceEndDate ?? addDays(today, 20)}T00:00:00Z`,
        ),
        lateFeePercentage: '5',
        lateFeeGraceDays: 10,
        collectionMode: 'AGENCY',
        feeMode: 'DEDUCTED',
        feePercentage: '5',
        status: data.status ?? 'PENDING',
      },
    })

  const payment = (
    installmentRow: { id: string; tenantId: string; contractId: string },
    data: {
      rent: string
      status?: 'CONFIRMED' | 'PENDING_CONFIRMATION' | 'VOIDED'
      lateFee?: string
    },
  ) =>
    prisma.payment.create({
      data: {
        tenantId: installmentRow.tenantId,
        installmentId: installmentRow.id,
        contractId: installmentRow.contractId,
        renterId: id(90),
        paidAt: new Date(`${today}T00:00:00Z`),
        paidCurrency: 'ARS',
        amount: Number(data.rent) + Number(data.lateFee ?? 0) || 1,
        amountInContractCurrency: Number(data.rent) + Number(data.lateFee ?? 0),
        kind: 'CASH_IN',
        method: 'TRANSFER',
        receivedBy: 'AGENCY',
        status: data.status ?? 'CONFIRMED',
        lateFeeApplied: data.lateFee ?? '0',
        rentApplied: data.rent,
        chargesApplied: '0',
        creditGenerated: '0',
        registeredById: id(93),
        voidedAt: data.status === 'VOIDED' ? new Date() : null,
      },
    })

  const dashboard = async () =>
    (
      await request(app.getHttpServer())
        .get(`/api/v1/reports/dashboard?period=${current}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
    ).body.data

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
    tenant = await createTenant(prisma, 'dash')
    await createUser(prisma, {
      tenantId: tenant.id,
      email: 'admin@dash.com',
      role: Role.ADMIN,
    })
    adminToken = await loginAs(app, 'admin@dash.com')
    seq = 0

    // Los 5 meses anteriores: una cuota saldada, una con un pago informado y
    // otro anulado (el anulado no cuenta), y una en dólares sin pagos.
    for (const period of periods.slice(0, -1)) {
      const paid = await installment({
        period,
        baseAmount: '100000',
        status: 'PAID',
      })
      await payment(paid, { rent: '100000' })
      const informed = await installment({ period, baseAmount: '80000' })
      await payment(informed, { rent: '30000', status: 'PENDING_CONFIRMATION' })
      await payment(informed, { rent: '50000', status: 'VOIDED' })
      await installment({ period, baseAmount: '500', currency: 'USD' })
    }

    // El mes en curso, una cuota por cada estado.
    const paid = await installment({
      period: current,
      baseAmount: '100000',
      status: 'PAID',
    })
    await payment(paid, { rent: '100000' })
    const partial = await installment({
      period: current,
      baseAmount: '100000',
      status: 'PARTIAL',
    })
    await payment(partial, { rent: '40000' })
    await installment({ period: current, baseAmount: '50000' })
    await installment({
      period: current,
      baseAmount: '100000',
      graceEndDate: addDays(today, -1),
    })
    await installment({ period: current, baseAmount: '300', currency: 'USD' })

    // Otro tenant: no tiene que sumarse.
    const other = await createTenant(prisma, 'dash-other')
    const foreign = await installment({
      period: current,
      baseAmount: '999999',
      tenantId: other.id,
    })
    await payment(foreign, { rent: '999999' })
  })

  it('el historial suma devengado y cobrado por mes y moneda', async () => {
    const { history } = await dashboard()

    expect(history).toHaveLength(HISTORY)
    for (const entry of history.slice(0, -1)) {
      expect(entry).toEqual({
        period: entry.period,
        accrued: [
          { currency: 'ARS', amount: '180000.00' },
          { currency: 'USD', amount: '500.00' },
        ],
        // 100.000 saldados + 30.000 informados; los 50.000 anulados no cuentan.
        collected: [{ currency: 'ARS', amount: '130000.00' }],
      })
    }
    expect(history.map((h: { period: string }) => h.period)).toEqual(periods)
    expect(history[HISTORY - 1]).toEqual({
      period: current,
      accrued: [
        { currency: 'ARS', amount: '350000.00' },
        { currency: 'USD', amount: '300.00' },
      ],
      collected: [{ currency: 'ARS', amount: '140000.00' }],
    })
  })

  it('el resto del dashboard sale de las cuotas del mes en curso', async () => {
    const body = await dashboard()

    expect(body.period).toBe(current)
    expect(body.installments.paid).toEqual({
      count: 1,
      amounts: [{ currency: 'ARS', amount: '100000.00' }],
    })
    expect(body.installments.partial).toEqual({
      count: 1,
      amounts: [{ currency: 'ARS', amount: '60000.00' }],
    })
    expect(body.installments.pending).toEqual({
      count: 2,
      amounts: [
        { currency: 'ARS', amount: '50000.00' },
        { currency: 'USD', amount: '300.00' },
      ],
    })
    // 100.000 de alquiler + 1 día de punitorio al 5 %.
    expect(body.installments.overdue).toEqual({
      count: 1,
      amounts: [{ currency: 'ARS', amount: '105000.00' }],
    })
    expect(body.lateFeesAccrued).toEqual([
      { currency: 'ARS', amount: '5000.00' },
    ])
    expect(body.lateFeesCollected).toEqual([])
    expect(Object.keys(body).sort()).toEqual(
      [
        'generatedAt',
        'filters',
        'period',
        'installments',
        'lateFeesAccrued',
        'lateFeesCollected',
        'feesAccrued',
        'todo',
        'expiringContracts',
        'history',
      ].sort(),
    )
  })

  it('el historial coincide con el camino viejo: hidratar todas las cuotas y sumar en memoria', async () => {
    const { history } = await dashboard()

    const rows = await RequestContext.run({ correlationId: 'oracle' }, () =>
      RequestContext.runInTenant(tenant.id, () =>
        app
          .get(BillingFacade)
          .reportInstallments({ periodFrom: periods[0], periodTo: current }),
      ),
    )

    expect(history).toEqual(buildHistory(periods, rows))
  })

  it('una cuota con varios pagos suma su alquiler una sola vez (el JOIN no multiplica)', async () => {
    const split = await installment({
      period: periods[0],
      baseAmount: '90000',
      status: 'PAID',
    })
    await payment(split, { rent: '30000' })
    await payment(split, { rent: '30000' })
    await payment(split, { rent: '30000', lateFee: '1500' })

    const { history } = await dashboard()
    const rows = await RequestContext.run({ correlationId: 'oracle' }, () =>
      RequestContext.runInTenant(tenant.id, () =>
        app
          .get(BillingFacade)
          .reportInstallments({ periodFrom: periods[0], periodTo: current }),
      ),
    )

    expect(history[0]).toEqual({
      period: periods[0],
      accrued: [
        { currency: 'ARS', amount: '270000.00' },
        { currency: 'USD', amount: '500.00' },
      ],
      collected: [{ currency: 'ARS', amount: '220000.00' }],
    })
    expect(history).toEqual(buildHistory(periods, rows))
  })

  it('un mes sin cuotas aparece igual, con importes vacíos', async () => {
    await prisma.payment.deleteMany({
      where: { installment: { period: periods[1] }, tenantId: tenant.id },
    })
    await prisma.installment.deleteMany({
      where: { tenantId: tenant.id, period: periods[1] },
    })
    const { history } = await dashboard()
    expect(history[1]).toEqual({
      period: periods[1],
      accrued: [],
      collected: [],
    })
  })

  it('cuenta los pagos por confirmar (los de todos los meses)', async () => {
    const informed = await installment({ period: current, baseAmount: '1000' })
    await payment(informed, {
      rent: '1000',
      status: 'PENDING_CONFIRMATION',
    })
    const { todo } = await dashboard()
    // El recién informado y uno por cada mes anterior.
    expect(todo.paymentsToConfirm).toBe(1 + (HISTORY - 1))
  })
})
