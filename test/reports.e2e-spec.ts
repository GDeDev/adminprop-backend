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
import { createTestApp, loginAs, loginToPortalAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'
import { waitFor } from './utils/wait-for'

const today = todayIso()
const previous = periodOf(addMonths(today, -1))

const binary = (
  res: request.Response,
  callback: (err: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = []
  res.on('data', (chunk: Buffer) => chunks.push(chunk))
  res.on('end', () => callback(null, Buffer.concat(chunks)))
}

/**
 * Estadísticas y reportes (Fase 19): importes por moneda, aislamiento entre
 * inmobiliarias, permisos y descargas auditadas.
 */
const zeroBreakdown = {
  rent: '0.00',
  lateFees: '0.00',
  charges: '0.00',
  total: '0.00',
}

describe('Estadísticas y reportes (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string }
  let tenantB: { id: string }
  let adminToken: string
  let employeeToken: string
  let adminBToken: string
  let master: { tolosa: string; casa: string }

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

  let counter = 0
  const nextId = () => String(80_000_000 + ++counter)

  const createContract = async (overrides: Record<string, unknown> = {}) => {
    const owner = await api(adminToken)
      .post('/owners')
      .send({
        firstName: 'Ana',
        lastName: `Gómez ${counter}`,
        nationalId: nextId(),
        email: `owner${counter}@mail.com`,
      })
      .expect(201)
    const property = await api(adminToken)
      .post('/properties')
      .send({
        address: `Calle ${++counter} 100`,
        locationId: master.tolosa,
        propertyTypeId: master.casa,
        ownerId: owner.body.data.id,
      })
      .expect(201)
    const renter = await api(adminToken)
      .post('/renters')
      .send({
        firstName: 'Iván',
        lastName: `López ${counter}`,
        nationalId: nextId(),
        phone: '2215550000',
      })
      .expect(201)
    const contract = await api(adminToken)
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
        ...overrides,
      })
      .expect(201)
    return {
      contractId: contract.body.data.id as string,
      ownerId: owner.body.data.id as string,
      renterId: renter.body.data.id as string,
      propertyId: property.body.data.id as string,
    }
  }

  const installmentOf = async (contractId: string) => {
    await api(adminToken)
      .post('/billing/installments/generate')
      .send({ period: previous })
      .expect(200)
    const list = await api(adminToken)
      .get(`/billing/installments?contractId=${contractId}&period=${previous}`)
      .expect(200)
    return list.body.data.data[0].id as string
  }

  const payInFull = async (installmentId: string) => {
    const req = api(adminToken).post(
      `/billing/installments/${installmentId}/payments`,
    )
    for (const [key, value] of Object.entries({
      paidCurrency: 'ARS',
      method: 'TRANSFER',
      paidAt: `${previous}-05`,
      amount: '100000',
    })) {
      req.field(key, value)
    }
    await req.expect(201)
  }

  /** Cuota del mes pasado pagada, con su liquidación confirmada. */
  let paid: Awaited<ReturnType<typeof createContract>>
  /** Contrato en dólares con la cuota del mes pasado impaga: vencida. */
  let late: Awaited<ReturnType<typeof createContract>>
  let paymentId: string

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
    for (const [tenant, email, role] of [
      [tenantA, 'admin@a.com', Role.ADMIN],
      [tenantA, 'empleado@a.com', Role.EMPLOYEE],
      [tenantB, 'admin@b.com', Role.ADMIN],
    ] as const) {
      await createUser(prisma, { tenantId: tenant.id, email, role })
    }
    adminToken = await loginAs(app, 'admin@a.com')
    employeeToken = await loginAs(app, 'empleado@a.com')
    adminBToken = await loginAs(app, 'admin@b.com')
    master = {
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
    }

    paid = await createContract()
    const installmentId = await installmentOf(paid.contractId)
    await payInFull(installmentId)
    let settlementId = ''
    await waitFor(async () => {
      const list = await api(adminToken)
        .get(`/settlements?contractId=${paid.contractId}`)
        .expect(200)
      settlementId = list.body.data.data[0]?.id ?? ''
      return settlementId !== ''
    })
    await api(adminToken)
      .post(`/settlements/${settlementId}/confirm`)
      .expect(200)
    const payments = await api(adminToken)
      .get(`/reports/financial/payments?from=${previous}&to=${previous}`)
      .expect(200)
    paymentId = payments.body.data.data[0].paymentId

    late = await createContract({
      currency: 'USD',
      initialRent: '500',
      deposit: '500',
      depositCurrency: 'USD',
    })
    await installmentOf(late.contractId)
  })

  describe('dashboard', () => {
    it('agrupa las cuotas del mes por estado y separa pesos de dólares', async () => {
      const response = await api(employeeToken)
        .get(`/reports/dashboard?period=${previous}`)
        .expect(200)
      const report = response.body.data

      expect(report.period).toBe(previous)
      expect(report.installments.paid.count).toBe(1)
      expect(report.installments.paid.amounts).toEqual([
        { currency: 'ARS', amount: '100000.00' },
      ])
      expect(report.installments.overdue.count).toBe(1)
      expect(
        report.installments.overdue.amounts.map((a: any) => a.currency),
      ).toEqual(['USD'])
      expect(report.installments.pending.amounts).toEqual([])
      expect(report.todo).toMatchObject({
        paymentsToConfirm: 0,
        settlementsToConfirm: 0,
        settlementsToTransfer: 1,
        openStatements: 0,
      })
      expect(report.history).toHaveLength(6)
      expect(report.history[5]).toMatchObject({
        period: previous,
        accrued: [
          { currency: 'ARS', amount: '100000.00' },
          { currency: 'USD', amount: '500.00' },
        ],
        collected: [{ currency: 'ARS', amount: '100000.00' }],
      })
      expect(report.history[0].period < report.history[5].period).toBe(true)
      expect(report.generatedAt).toEqual(expect.any(String))
      expect(report.filters).toEqual({ period: previous })
    })

    it('lista los contratos por vencer dentro de los días de aviso de la inmobiliaria', async () => {
      await prisma.tenant.update({
        where: { id: tenantA.id },
        data: { contractExpiryNoticeDays: 1000 },
      })
      const response = await api(adminToken)
        .get('/reports/dashboard')
        .expect(200)
      expect(response.body.data.expiringContracts).toHaveLength(2)
      expect(response.body.data.expiringContracts[0]).toMatchObject({
        renewalInProgress: false,
        propertyAddress: expect.stringContaining('Calle'),
      })
    })

    it('la otra inmobiliaria ve su dashboard vacío', async () => {
      const response = await api(adminBToken)
        .get(`/reports/dashboard?period=${previous}`)
        .expect(200)
      const report = response.body.data
      expect(report.installments.paid).toEqual({ count: 0, amounts: [] })
      expect(report.installments.overdue).toEqual({ count: 0, amounts: [] })
      expect(report.todo.settlementsToTransfer).toBe(0)
      expect(report.expiringContracts).toEqual([])
      expect(report.history.every((h: any) => h.accrued.length === 0)).toBe(
        true,
      )
    })
  })

  describe('financieros', () => {
    it('ingresos: cobrado por fecha de pago y honorarios y neto por mes de liquidación, por moneda', async () => {
      const current = periodOf(today)
      const response = await api(adminToken)
        .get(`/reports/financial/income?from=${previous}&to=${current}`)
        .expect(200)
      const rows = response.body.data.rows
      expect(rows).toHaveLength(2)
      // Lo cobrado se cuenta en el mes del pago...
      expect(rows[0]).toMatchObject({
        period: previous,
        currency: 'ARS',
        rentCollected: '100000.00',
        lateFeesCollected: '0.00',
        chargesCollected: '0.00',
        feesAccrued: '0.00',
        netSettled: '0.00',
      })
      // ...y la liquidación, en el mes en que se confirmó (5% de honorarios descontados).
      expect(rows[1]).toEqual({
        period: current,
        currency: 'ARS',
        rentCollected: '0.00',
        lateFeesCollected: '0.00',
        chargesCollected: '0.00',
        collectedByReceiver: {
          agency: zeroBreakdown,
          owner: zeroBreakdown,
        },
        feesAccrued: '5000.00',
        feesCollected: '5000.00',
        netSettled: '95000.00',
        netTransferred: '0.00',
      })
      expect(response.body.data.filters).toEqual({
        from: previous,
        to: current,
      })
    })

    it('ingresos: separa lo cobrado por la inmobiliaria de lo percibido por el propietario, por moneda (D-235)', async () => {
      const direct = await createContract({
        collectionMode: 'OWNER_DIRECT',
        initialRent: '40000',
        lateFeeGraceDays: 31,
      })
      const installmentId = await installmentOf(direct.contractId)
      const req = api(adminToken).post(
        `/billing/installments/${installmentId}/payments`,
      )
      for (const [key, value] of Object.entries({
        paidCurrency: 'ARS',
        method: 'TRANSFER',
        paidAt: `${previous}-06`,
        amount: '40000',
      })) {
        req.field(key, value)
      }
      const informed = await req.expect(201)
      const directPaymentId = informed.body.data.payment.id as string

      const income = () =>
        api(adminToken)
          .get(`/reports/financial/income?from=${previous}&to=${previous}`)
          .expect(200)

      // Informado y sin confirmar: todavía no es un ingreso de nadie.
      const before = (await income()).body.data
      expect(before.rows[0].collectedByReceiver.owner.total).toBe('0.00')

      await api(adminToken)
        .post(`/billing/payments/${directPaymentId}/confirm`)
        .expect(200)

      const data = (await income()).body.data
      expect(data.rows).toHaveLength(1)
      // El total de siempre mezcla los dos; el desglose los separa.
      expect(data.rows[0]).toMatchObject({
        rentCollected: '140000.00',
        collectedByReceiver: {
          agency: { rent: '100000.00', total: '100000.00' },
          owner: { rent: '40000.00', total: '40000.00' },
        },
      })
      expect(data.totals).toEqual([
        {
          currency: 'ARS',
          collected: {
            rent: '140000.00',
            lateFees: '0.00',
            charges: '0.00',
            total: '140000.00',
          },
          collectedByReceiver: {
            agency: {
              rent: '100000.00',
              lateFees: '0.00',
              charges: '0.00',
              total: '100000.00',
            },
            owner: {
              rent: '40000.00',
              lateFees: '0.00',
              charges: '0.00',
              total: '40000.00',
            },
          },
        },
      ])

      // El filtro por propietario sigue funcionando en el reporte de pagos.
      const payments = await api(adminToken)
        .get(
          `/reports/financial/payments?from=${previous}&to=${previous}&ownerId=${direct.ownerId}`,
        )
        .expect(200)
      expect(payments.body.data.data).toHaveLength(1)
    })

    it('ingresos: sin filtros usa los últimos 6 meses y rechaza rangos inválidos', async () => {
      await api(adminToken).get('/reports/financial/income').expect(200)
      await api(adminToken)
        .get('/reports/financial/income?from=2026-10&to=2026-01')
        .expect(400)
      await api(adminToken)
        .get('/reports/financial/income?from=hoy')
        .expect(400)
    })

    it('pagos: lista los confirmados con nombres, pagina y filtra', async () => {
      const response = await api(adminToken)
        .get(`/reports/financial/payments?from=${previous}&to=${previous}`)
        .expect(200)
      expect(response.body.data.pagination.total).toBe(1)
      expect(response.body.data.data[0]).toMatchObject({
        paymentId,
        paidAt: `${previous}-05`,
        period: previous,
        amount: '100000.00',
        currency: 'ARS',
        method: 'TRANSFER',
        receivedBy: 'AGENCY',
        propertyAddress: expect.stringContaining('Calle'),
        ownerName: expect.stringContaining('Gómez'),
        renterName: expect.stringContaining('López'),
      })

      const other = await api(adminToken)
        .get(
          `/reports/financial/payments?from=${previous}&to=${previous}&ownerId=${late.ownerId}`,
        )
        .expect(200)
      expect(other.body.data.data).toEqual([])

      const mine = await api(adminToken)
        .get(
          `/reports/financial/payments?from=${previous}&to=${previous}&renterId=${paid.renterId}&limit=1`,
        )
        .expect(200)
      expect(mine.body.data.data).toHaveLength(1)
      expect(mine.body.data.pagination.limit).toBe(1)
    })

    it('mora: el inquilino con la cuota vencida, con saldo y punitorio por moneda y teléfono', async () => {
      const response = await api(employeeToken)
        .get('/reports/financial/arrears')
        .expect(200)
      const { rows, totals } = response.body.data
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        renterId: late.renterId,
        renterPhone: '2215550000',
        overdueInstallments: 1,
      })
      expect(rows[0].maxDaysOverdue).toBeGreaterThan(0)
      expect(rows[0].balance.map((b: any) => b.currency)).toEqual(['USD'])
      expect(Number(rows[0].balance[0].amount)).toBeGreaterThanOrEqual(500)
      expect(totals).toEqual(rows[0].balance)

      const none = await api(adminToken)
        .get('/reports/financial/arrears?minDays=3000')
        .expect(200)
      expect(none.body.data.rows).toEqual([])
    })
  })

  describe('operativos', () => {
    it('propiedades: alquiladas con su inquilino y alquiler, disponibles con días sin alquilar', async () => {
      const vacant = await api(adminToken)
        .post('/properties')
        .send({
          address: 'Calle Vacía 1',
          locationId: master.tolosa,
          propertyTypeId: master.casa,
          ownerId: paid.ownerId,
        })
        .expect(201)

      const rented = await api(adminToken)
        .get('/reports/operations/properties?status=RENTED')
        .expect(200)
      expect(rented.body.data.rows).toHaveLength(2)
      const usd = rented.body.data.rows.find(
        (r: any) => r.propertyId === late.propertyId,
      )
      expect(usd).toMatchObject({
        status: 'RENTED',
        rent: { currency: 'USD', amount: '500.00' },
        daysVacant: null,
      })
      expect(usd.renterName).toContain('López')

      const available = await api(adminToken)
        .get('/reports/operations/properties?status=AVAILABLE')
        .expect(200)
      expect(available.body.data.rows).toEqual([
        expect.objectContaining({
          propertyId: vacant.body.data.id,
          status: 'AVAILABLE',
          rent: null,
          daysVacant: 0,
        }),
      ])

      const all = await api(adminToken)
        .get('/reports/operations/properties')
        .expect(200)
      expect(all.body.data.rows).toHaveLength(3)
    })

    it('contratos por vencer: ordenados por fin, con los días que faltan', async () => {
      const response = await api(adminToken)
        .get('/reports/operations/expiring-contracts?withinDays=700')
        .expect(200)
      expect(response.body.data.rows).toHaveLength(2)
      expect(response.body.data.rows[0].daysLeft).toBeGreaterThan(0)

      const none = await api(adminToken)
        .get('/reports/operations/expiring-contracts?withinDays=5')
        .expect(200)
      expect(none.body.data.rows).toEqual([])
    })

    it('servicios vencidos: responde la lista (vacía sin servicios)', async () => {
      const response = await api(adminToken)
        .get('/reports/operations/services?status=overdue')
        .expect(200)
      expect(response.body.data.rows).toEqual([])
      await api(adminToken)
        .get('/reports/operations/services?status=otro')
        .expect(400)
    })
  })

  describe('aislamiento y permisos', () => {
    it('la otra inmobiliaria no ve nada de la primera en ningún reporte', async () => {
      const urls = [
        `/reports/financial/income?from=${previous}&to=${previous}`,
        `/reports/financial/payments?from=${previous}&to=${previous}`,
        `/reports/financial/payments?from=${previous}&to=${previous}&ownerId=${paid.ownerId}`,
        '/reports/financial/arrears',
        '/reports/operations/properties',
        '/reports/operations/expiring-contracts?withinDays=700',
        '/reports/operations/services',
      ]
      for (const url of urls) {
        const body = (await api(adminBToken).get(url).expect(200)).body.data
        const rows = body.rows ?? body.data
        expect(rows).toEqual([])
      }
    })

    it('un propietario del portal recibe 403, y sin token 401', async () => {
      await createUser(prisma, {
        tenantId: tenantA.id,
        email: 'duenio@a.com',
        role: Role.OWNER,
      })
      const portalToken = await loginToPortalAs(
        app,
        'tenant-a',
        'duenio@a.com',
        'OWNER',
      )
      await api(portalToken).get('/reports/dashboard').expect(403)
      await request(app.getHttpServer())
        .get('/api/v1/reports/dashboard')
        .expect(401)
    })
  })

  describe('descargas', () => {
    const download = (token: string, url: string) =>
      api(token).get(url).buffer(true).parse(binary).expect(200)

    it('XLSX, CSV y PDF con los mismos filtros, y cada descarga queda auditada', async () => {
      const xlsx = await download(
        employeeToken,
        `/reports/financial/income?from=${previous}&to=${previous}&format=xlsx`,
      )
      expect(xlsx.headers['content-type']).toContain('spreadsheetml')
      expect(xlsx.headers['content-disposition']).toContain(
        'attachment; filename="ingresos-',
      )
      expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK')

      const csv = await download(
        adminToken,
        `/reports/financial/payments?from=${previous}&to=${previous}&format=csv`,
      )
      const text = (csv.body as Buffer).toString('utf8')
      expect(csv.headers['content-type']).toContain('text/csv')
      expect(text.startsWith('﻿')).toBe(true)
      expect(text).toContain('Fecha de pago;Cuota;Inquilino')
      expect(text).toContain('100000.00;ARS;Transferencia;Inmobiliaria')

      const pdf = await download(
        adminToken,
        '/reports/financial/arrears?format=pdf',
      )
      expect(pdf.headers['content-type']).toContain('application/pdf')
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF')

      const audit = await api(adminToken)
        .get('/audit?action=EXPORT')
        .expect(200)
      expect(audit.body.data.data).toHaveLength(3)
      expect(audit.body.data.data[0]).toMatchObject({
        entity: 'Report',
        action: 'EXPORT',
        userEmail: 'admin@a.com',
      })
      expect(
        audit.body.data.data.map((entry: any) => entry.userEmail).sort(),
      ).toEqual(['admin@a.com', 'admin@a.com', 'empleado@a.com'])
      expect(audit.body.data.data[0].summary).toContain('Exportó el reporte')

      // La otra inmobiliaria no ve esas exportaciones.
      const other = await api(adminBToken)
        .get('/audit?action=EXPORT')
        .expect(200)
      expect(other.body.data.data).toEqual([])
    })

    it('exporta los pagos completos aunque el listado pagine', async () => {
      const csv = await download(
        adminToken,
        `/reports/financial/payments?from=${previous}&to=${previous}&limit=1&format=csv`,
      )
      expect((csv.body as Buffer).toString('utf8')).toContain('Total')
    })

    it('rechaza un formato inválido', async () => {
      await api(adminToken)
        .get('/reports/financial/income?format=docx')
        .expect(400)
    })
  })
})
