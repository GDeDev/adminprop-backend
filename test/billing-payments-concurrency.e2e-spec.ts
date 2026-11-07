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

const today = todayIso()
/** El mes pasado: todas sus fechas ya pasaron. */
const previous = periodOf(addMonths(today, -1))
const day = (n: number) => `${previous}-${String(n).padStart(2, '0')}`

/**
 * Registrar pagos sobre la misma cuota a la vez, y la idempotencia del POST
 * (auditoría de datos, A3). Antes los saldos se calculaban fuera de la
 * transacción: dos pagos simultáneos leían el mismo saldo y los dos lo
 * imputaban entero.
 */
describe('Pagos concurrentes e idempotencia (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenant: { id: string }
  let adminToken: string
  let installmentId: string

  const api = (token = adminToken) => ({
    get: (url: string) =>
      request(app.getHttpServer())
        .get(`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`),
    post: (url: string) =>
      request(app.getHttpServer())
        .post(`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`),
  })

  let counter = 0

  /** Un contrato de 100.000 sin punitorio (gracia de todo el mes) y su cuota. */
  const createInstallment = async (): Promise<string> => {
    const master = {
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
    const owner = await api()
      .post('/owners')
      .send({
        firstName: 'Juan',
        lastName: 'Pérez',
        nationalId: String(40_000_000 + ++counter),
      })
      .expect(201)
    const property = await api()
      .post('/properties')
      .send({
        address: `Calle ${++counter}`,
        locationId: master.tolosa,
        propertyTypeId: master.casa,
        ownerId: owner.body.data.id,
      })
      .expect(201)
    const renter = await api()
      .post('/renters')
      .send({
        firstName: 'Iván',
        lastName: 'López',
        nationalId: String(40_000_000 + ++counter),
      })
      .expect(201)
    const contract = await api()
      .post('/contracts')
      .send({
        propertyId: property.body.data.id,
        renterId: renter.body.data.id,
        startDate: addMonths(today, -2),
        endDate: addDays(addMonths(today, 22), -1),
        initialRent: '100000',
        currency: 'ARS',
        rentUpdateType: 'FIXED',
        rentUpdateFrequency: 'QUARTERLY',
        deposit: '100000',
        hasSurety: false,
        lateFeeGraceDays: 31,
      })
      .expect(201)
    await api()
      .post('/billing/installments/generate')
      .send({ period: previous })
      .expect(200)
    const list = await api()
      .get(
        `/billing/installments?contractId=${contract.body.data.id}&period=${previous}`,
      )
      .expect(200)
    return list.body.data.data[0].id
  }

  const pay = (amount: string, options: { key?: string; id?: string } = {}) => {
    const req = api().post(
      `/billing/installments/${options.id ?? installmentId}/payments`,
    )
    if (options.key) req.set('Idempotency-Key', options.key)
    for (const [k, v] of Object.entries({
      paidAt: day(5),
      amount,
      paidCurrency: 'ARS',
      method: 'TRANSFER',
    })) {
      req.field(k, v)
    }
    return req
  }

  const paymentRows = () =>
    prisma.payment.findMany({
      where: { installmentId },
      orderBy: { createdAt: 'asc' },
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
    tenant = await createTenant(prisma, 'tenant-pay')
    await seedBaseMasterData(prisma, tenant.id, { withSampleCities: true })
    await createUser(prisma, {
      tenantId: tenant.id,
      email: 'admin@pay.com',
      role: Role.ADMIN,
    })
    adminToken = await loginAs(app, 'admin@pay.com')
    installmentId = await createInstallment()
  })

  describe('dos pagos a la vez sobre la misma cuota', () => {
    it('los dos pagan la cuota entera: uno se registra y el otro recibe 409', async () => {
      const responses = await Promise.all([pay('100000'), pay('100000')])

      expect(responses.map((r) => r.status).sort()).toEqual([201, 409])
      expect(responses.find((r) => r.status === 409)?.body.code).toBe(
        'INSTALLMENT_ALREADY_PAID',
      )
      const rows = await paymentRows()
      expect(rows).toHaveLength(1)
      expect(rows[0].rentApplied.toString()).toBe('100000')
      expect(await prisma.renterCredit.count()).toBe(0)
    })

    it('dos pagos parciales que juntos pasan la deuda: el segundo se imputa contra lo que dejó el primero', async () => {
      // Antes los dos aplicaban 60.000 de alquiler (120.000 sobre una cuota
      // de 100.000) y el exceso no generaba saldo a favor.
      const responses = await Promise.all([pay('60000'), pay('60000')])

      expect(responses.map((r) => r.status)).toEqual([201, 201])
      const rows = await paymentRows()
      expect(rows).toHaveLength(2)
      const rent = rows.reduce((sum, r) => sum + Number(r.rentApplied), 0)
      const credit = rows.reduce((sum, r) => sum + Number(r.creditGenerated), 0)
      expect(rent).toBe(100000)
      expect(credit).toBe(20000)
      const credits = await prisma.renterCredit.findMany()
      expect(credits).toHaveLength(1)
      expect(credits[0].amount.toString()).toBe('20000')
      const detail = await api().get(`/billing/installments/${installmentId}`)
      expect(detail.body.data.status).toBe('PAID')
    })

    it('muchos pagos parciales a la vez nunca imputan más alquiler que la cuota', async () => {
      const responses = await Promise.all(
        Array.from({ length: 6 }, () => pay('30000')),
      )

      const rows = await paymentRows()
      const rent = rows.reduce((sum, r) => sum + Number(r.rentApplied), 0)
      expect(rent).toBe(100000)
      // 4 pagos cubren 100.000 (3 de 30.000 y uno que completa); el resto
      // llegó con la cuota ya saldada.
      expect(responses.filter((r) => r.status === 201)).toHaveLength(4)
      expect(
        responses
          .filter((r) => r.status !== 201)
          .every((r) => r.status === 409),
      ).toBe(true)
    })
  })

  describe('Idempotency-Key', () => {
    it('repetir el pedido con la misma clave devuelve el mismo pago y no crea otro', async () => {
      const first = await pay('40000', { key: 'pago-1' }).expect(201)
      const second = await pay('40000', { key: 'pago-1' }).expect(201)

      expect(second.body.data.payment.id).toBe(first.body.data.payment.id)
      expect(await paymentRows()).toHaveLength(1)
    })

    it('el reintento de un pago que saldó la cuota devuelve ese pago, no 409', async () => {
      const first = await pay('100000', { key: 'pago-total' }).expect(201)
      const retry = await pay('100000', { key: 'pago-total' }).expect(201)

      expect(retry.body.data.payment.id).toBe(first.body.data.payment.id)
      expect(retry.body.data.installment.status).toBe('PAID')
      expect(await paymentRows()).toHaveLength(1)
    })

    it('el mismo pedido con la misma clave a la vez: un solo pago, todos responden lo mismo', async () => {
      const responses = await Promise.all(
        Array.from({ length: 4 }, () => pay('40000', { key: 'doble-click' })),
      )

      expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201])
      expect(new Set(responses.map((r) => r.body.data.payment.id)).size).toBe(1)
      expect(await paymentRows()).toHaveLength(1)
    })

    it('la misma clave con otro monto es un error, y no registra nada', async () => {
      await pay('40000', { key: 'pago-2' }).expect(201)
      const reused = await pay('50000', { key: 'pago-2' }).expect(409)

      expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED')
      expect(await paymentRows()).toHaveLength(1)
    })

    it('claves distintas son pedidos distintos', async () => {
      await pay('40000', { key: 'a' }).expect(201)
      await pay('40000', { key: 'b' }).expect(201)
      expect(await paymentRows()).toHaveLength(2)
    })

    it('sin clave, repetir el pedido registra otro pago (el comportamiento de siempre)', async () => {
      await pay('40000').expect(201)
      await pay('40000').expect(201)
      expect(await paymentRows()).toHaveLength(2)
    })

    it('una clave inválida se rechaza con 400', async () => {
      const response = await pay('40000', { key: 'con espacio' }).expect(400)
      expect(response.body.code).toBe('IDEMPOTENCY_KEY_INVALID')
      expect(await paymentRows()).toHaveLength(0)
    })

    it('si el pago falla no queda la clave: el reintento corrige y pasa', async () => {
      await pay('100000').expect(201)
      // La cuota ya está saldada: 409, y la clave no se guarda.
      await pay('1000', { key: 'tarde' }).expect(409)
      expect(await prisma.idempotencyKey.count()).toBe(0)
    })

    it('una clave vencida vale como nueva', async () => {
      await pay('40000', { key: 'vieja' }).expect(201)
      await prisma.$executeRawUnsafe(
        `UPDATE idempotency_keys SET expires_at = now() - interval '1 hour'`,
      )

      const again = await pay('40000', { key: 'vieja' }).expect(201)

      expect(await paymentRows()).toHaveLength(2)
      expect(again.body.data.payment.id).toBeDefined()
      const keys = await prisma.idempotencyKey.findMany()
      expect(keys).toHaveLength(1)
      expect(keys[0].expiresAt.getTime()).toBeGreaterThan(Date.now())
    })

    it('la clave es por inmobiliaria: otra puede usar la misma sin chocar', async () => {
      await pay('40000', { key: 'compartida' }).expect(201)
      const other = await createTenant(prisma, 'tenant-pay-2')
      await prisma.idempotencyKey.create({
        data: {
          tenantId: other.id,
          scope: 'billing.register-payment',
          key: 'compartida',
          requestHash: 'x'.repeat(64),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      })
      expect(await prisma.idempotencyKey.count()).toBe(2)
    })
  })
})
