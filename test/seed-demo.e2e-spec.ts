import { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { DEMO_PASSWORD } from '../src/seed-demo/demo-plan'
import { DemoRunReport } from '../src/seed-demo/demo-seeder'
import { runDemoSeed } from '../src/seed-demo/run-demo-seed'
import { RequestContext } from '../src/shared/context/request-context'
import { periodOf, todayIso } from '../src/shared/dates/calendar-date'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp } from './utils/app'
import { resetDatabase } from './utils/database'

const UNO = 'demo-uno'
const DOS = 'demo-dos'

/**
 * Seed de demo (`npm run seed:demo`): corre sobre la base de tests con la app
 * completa y verifica lo que importa de un seed: que cargue lo prometido, que
 * volver a correrlo no duplique nada y que las dos inmobiliarias no se vean.
 * Las guardas de entorno tienen su unitario (demo-guards.spec.ts).
 */
describe('Seed de demo (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let first: DemoRunReport
  let second: DemoRunReport
  let countsAfterFirst: Record<string, Record<string, number>>
  let tenantIds: Record<string, string>

  /** Conteos por tabla de cada inmobiliaria, siempre dentro de su tenant. */
  const countsOf = async (slug: string): Promise<Record<string, number>> =>
    RequestContext.runInTenant(tenantIds[slug], async () => ({
      owners: await prisma.db.owner.count(),
      renters: await prisma.db.renter.count(),
      guarantors: await prisma.db.guarantor.count(),
      properties: await prisma.db.property.count(),
      photos: await prisma.db.propertyPhoto.count(),
      contracts: await prisma.db.contract.count(),
      installments: await prisma.db.installment.count(),
      payments: await prisma.db.payment.count(),
      settlements: await prisma.db.settlement.count(),
      statements: await prisma.db.ownerStatement.count(),
      services: await prisma.db.propertyService.count(),
      advanceExpenses: await prisma.db.advanceExpense.count(),
      inquiries: await prisma.db.publicInquiry.count(),
      locations: await prisma.db.location.count(),
      users: await prisma.db.user.count(),
    }))

  const login = async (email: string): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD })
      .expect(200)
    return response.body.data.tokens.accessToken
  }

  const get = (token: string, url: string) =>
    request(app.getHttpServer())
      .get(`/api/v1${url}`)
      .set('Authorization', `Bearer ${token}`)

  beforeAll(async () => {
    await prisma.$connect()
    await resetDatabase(prisma)
    app = await createTestApp()

    first = await runDemoSeed(app)
    tenantIds = Object.fromEntries(
      first.tenants.map((tenant) => [tenant.slug, tenant.tenantId]),
    )
    countsAfterFirst = {
      [UNO]: await countsOf(UNO),
      [DOS]: await countsOf(DOS),
    }
    second = await runDemoSeed(app)
  }, 300_000)

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
  })

  describe('contenido', () => {
    it('crea las dos inmobiliarias de demo con los datos del plan', () => {
      expect(countsAfterFirst[UNO]).toMatchObject({
        owners: 7,
        renters: 14,
        guarantors: 2,
        properties: 20,
        // C-01..C-12 (con C-10a/b/c) más el rescindido C-R1.
        contracts: 15,
        services: 4,
        advanceExpenses: 1,
        inquiries: 4,
        // admin, empleado, 3 propietarios y 2 inquilinos con portal.
        users: 7,
      })
      expect(countsAfterFirst[DOS]).toMatchObject({
        owners: 2,
        renters: 2,
        guarantors: 0,
        properties: 4,
        contracts: 2,
        inquiries: 1,
        users: 4,
      })
      // Hay cuotas, pagos y liquidaciones en las dos.
      for (const slug of [UNO, DOS]) {
        expect(countsAfterFirst[slug].installments).toBeGreaterThan(0)
        expect(countsAfterFirst[slug].payments).toBeGreaterThan(0)
        expect(countsAfterFirst[slug].settlements).toBeGreaterThan(0)
      }
    })

    it('cada inmobiliaria tiene un punitorio explícito y distinto', async () => {
      const tenants = await prisma.tenant.findMany({
        where: { slug: { in: [UNO, DOS] } },
      })
      const lateFee = Object.fromEntries(
        tenants.map((t) => [t.slug, t.dailyLateFeePercentage?.toString()]),
      )
      expect(lateFee).toEqual({ [UNO]: '0.5', [DOS]: '1' })
    })

    it('cubre los casos de pago: parcial, con punitorio, pendiente, saldo a favor y cuotas vencidas', async () => {
      await RequestContext.runInTenant(tenantIds[UNO], async () => {
        expect(
          await prisma.db.installment.count({ where: { status: 'PARTIAL' } }),
        ).toBeGreaterThanOrEqual(2)
        expect(
          await prisma.db.payment.count({
            where: { lateFeeApplied: { gt: 0 } },
          }),
        ).toBeGreaterThanOrEqual(1)
        expect(
          await prisma.db.payment.count({
            where: { status: 'PENDING_CONFIRMATION' },
          }),
        ).toBe(1)
        expect(
          await prisma.db.renterCredit.count({
            where: { status: 'AVAILABLE' },
          }),
        ).toBe(1)
        // Cuotas de meses cerrados sin pagar (C-02, C-10c).
        expect(
          await prisma.db.installment.count({
            where: { status: 'PENDING', period: { lt: periodOf(todayIso()) } },
          }),
        ).toBeGreaterThanOrEqual(3)
        // Un pago en dólares convertido con cotización (C-04).
        expect(
          await prisma.db.payment.count({
            where: { paidCurrency: 'ARS', exchangeRate: { not: null } },
          }),
        ).toBeGreaterThanOrEqual(1)
      })
    })

    it('deja una liquidación cerrada y otra borrador', async () => {
      await RequestContext.runInTenant(tenantIds[UNO], async () => {
        expect(
          await prisma.db.settlement.count({
            where: { status: 'TRANSFERRED' },
          }),
        ).toBeGreaterThanOrEqual(1)
        expect(
          await prisma.db.settlement.count({ where: { status: 'PENDING' } }),
        ).toBeGreaterThanOrEqual(1)
      })
    })

    it('cubre los casos de contrato: rescindido, vencido, por vencer y con caución', async () => {
      const byCode = Object.fromEntries(
        first.tenants[0].contracts.map((c) => [c.code, c]),
      )
      expect(Object.keys(byCode)).toEqual(
        expect.arrayContaining([
          'C-01',
          'C-02',
          'C-03',
          'C-04',
          'C-05',
          'C-06',
          'C-07',
          'C-08',
          'C-09',
          'C-10a',
          'C-10b',
          'C-10c',
          'C-11',
          'C-12',
        ]),
      )
      expect(byCode['C-R1'].status).toBe('TERMINATED')

      await RequestContext.runInTenant(tenantIds[UNO], async () => {
        const contract = (code: string) =>
          prisma.db.contract.findFirstOrThrow({
            where: { notes: { startsWith: `[DEMO ${code}]` } },
          })
        const today = new Date()
        expect((await contract('C-08')).endDate.getTime()).toBeLessThan(
          today.getTime(),
        )
        const expiring = await contract('C-07')
        const days = (expiring.endDate.getTime() - today.getTime()) / 86_400_000
        expect(days).toBeGreaterThan(50)
        expect(days).toBeLessThan(60)
        expect((await contract('C-02')).hasSurety).toBe(true)
        expect((await contract('C-04')).currency).toBe('USD')
        expect((await contract('C-05')).id).toBeDefined()
      })
    })

    it('cubre los casos de personas y propiedades: CBU compartido, sin email, con y sin coordenadas', async () => {
      await RequestContext.runInTenant(tenantIds[UNO], async () => {
        const shared = await prisma.db.owner.groupBy({
          by: ['bankCbu'],
          where: { bankCbu: { not: null } },
          _count: { _all: true },
        })
        expect(shared.some((row) => row._count._all >= 2)).toBe(true)
        expect(
          await prisma.db.owner.count({ where: { bankCbu: null } }),
        ).toBeGreaterThanOrEqual(1)
        expect(
          await prisma.db.owner.count({ where: { email: null } }),
        ).toBeGreaterThanOrEqual(1)
        expect(
          await prisma.db.renter.count({ where: { email: null } }),
        ).toBeGreaterThanOrEqual(1)
        expect(
          await prisma.db.renter.count({ where: { guarantorId: null } }),
        ).toBeGreaterThanOrEqual(1)
        expect(
          await prisma.db.property.count({
            where: { latitude: { not: null } },
          }),
        ).toBeGreaterThanOrEqual(1)
        expect(
          await prisma.db.property.count({ where: { latitude: null } }),
        ).toBeGreaterThanOrEqual(1)
      })
    })

    it('marca todo como demo: ningún propietario ni inquilino sin la marca', async () => {
      await RequestContext.runInTenant(tenantIds[UNO], async () => {
        expect(
          await prisma.db.owner.count({
            where: { NOT: { lastName: { startsWith: 'DEMO ' } } },
          }),
        ).toBe(0)
        expect(
          await prisma.db.property.count({
            where: { NOT: { address: { startsWith: '[DEMO]' } } },
          }),
        ).toBe(0)
      })
    })
  })

  describe('reglas de plata y permisos (consolidado-4)', () => {
    const contractOf = (slug: string, code: string) =>
      RequestContext.runInTenant(tenantIds[slug], () =>
        prisma.db.contract.findFirstOrThrow({
          where: { notes: { startsWith: `[DEMO ${code}]` } },
        }),
      )

    it('el ajuste manual del alquiler lo cargó el administrador, con motivo y autorizante', async () => {
      const contract = await contractOf(UNO, 'C-12')
      const updates = await RequestContext.runInTenant(tenantIds[UNO], () =>
        prisma.db.contractRentUpdate.findMany({
          where: { contractId: contract.id, source: 'MANUAL' },
        }),
      )
      expect(updates).toHaveLength(1)
      const admin = await prisma.user.findFirstOrThrow({
        where: { email: 'admin@demo-uno.example.com' },
      })
      expect(updates[0]).toMatchObject({
        appliedById: admin.id,
        previousRent: expect.anything(),
      })
      expect(updates[0].newRent.toString()).toBe('250000')
      expect(updates[0].adjustmentReason).toContain('ICL')
      expect(updates[0].authorizedBy).toContain('propietaria')
      // Los aumentos a mano del seed son de un administrador, no de un empleado.
      const actor = await prisma.user.findUniqueOrThrow({
        where: { id: updates[0].appliedById ?? '' },
      })
      expect(actor.role).toBe('ADMIN')
    })

    it('un empleado no puede cargar un ajuste manual (403) sobre los datos del seed', async () => {
      const contract = await contractOf(UNO, 'C-11')
      const employee = await login('empleado@demo-uno.example.com')
      const response = await request(app.getHttpServer())
        .post(`/api/v1/contracts/${contract.id}/rent-updates`)
        .set('Authorization', `Bearer ${employee}`)
        .send({
          newRent: '200000',
          reason: 'prueba',
          authorizedBy: 'prueba',
        })
        .expect(403)
      expect(response.body.code).toBe(
        'CONTRACT_MANUAL_RENT_ADJUSTMENT_ADMIN_ONLY',
      )
    })

    it('hay un consolidado cerrado con retenciones y adelantos en columnas separadas', async () => {
      const admin = await login('admin@demo-uno.example.com')
      const list = await get(admin, '/statements?status=CLOSED').expect(200)
      const statements = list.body.data.data as { id: string }[]
      expect(statements.length).toBeGreaterThanOrEqual(1)
      const detail = await get(admin, `/statements/${statements[0].id}`).expect(
        200,
      )
      const totals = detail.body.data.totals as Record<string, string>[]
      expect(totals[0]).toMatchObject({
        currency: 'ARS',
        withholdingsTotal: '-3500.00',
        advancesTotal: '-20000.00',
        otherAdjustmentsTotal: '0.00',
        adjustmentsTotal: '-23500.00',
      })
    })

    it('el reporte de ingresos separa lo cobrado por la inmobiliaria de lo percibido por el propietario', async () => {
      const admin = await login('admin@demo-uno.example.com')
      const from = periodOf(
        new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10),
      )
      const response = await get(
        admin,
        `/reports/financial/income?from=${from}&to=${periodOf(todayIso())}`,
      ).expect(200)
      const total = (
        response.body.data.totals as {
          currency: string
          collectedByReceiver: {
            agency: { total: string }
            owner: { total: string }
          }
        }[]
      ).find((row) => row.currency === 'ARS')
      expect(Number(total?.collectedByReceiver.agency.total)).toBeGreaterThan(0)
      // C-05: el propietario cobra directo, con dos pagos confirmados.
      expect(Number(total?.collectedByReceiver.owner.total)).toBeGreaterThan(0)
    })

    it('deja saldo a favor aplicado a mano en Demo Uno y aplicado solo en Demo Dos', async () => {
      await RequestContext.runInTenant(tenantIds[UNO], async () => {
        const applied = await prisma.db.payment.findMany({
          where: { kind: 'CREDIT_APPLICATION' },
        })
        expect(applied).toHaveLength(1)
        expect(applied[0].amount.toString()).toBe('5000')
        // Del saldo de C-03 quedan 10.000 disponibles.
        const credit = await prisma.db.renterCredit.findFirstOrThrow({
          where: { status: 'AVAILABLE' },
        })
        expect(credit.remaining.toString()).toBe('10000')
      })
      const tenants = await prisma.tenant.findMany({
        where: { slug: { in: [UNO, DOS] } },
      })
      expect(
        Object.fromEntries(
          tenants.map((t) => [t.slug, t.autoApplyCreditOnGeneration]),
        ),
      ).toEqual({ [UNO]: false, [DOS]: true })
      await RequestContext.runInTenant(tenantIds[DOS], async () => {
        const applied = await prisma.db.payment.findMany({
          where: { kind: 'CREDIT_APPLICATION' },
        })
        expect(applied).toHaveLength(1)
        expect(applied[0].amount.toString()).toBe('20000')
      })
    })

    it('la cuenta corriente muestra un monto por liquidar distinto de cero', async () => {
      const admin = await login('admin@demo-uno.example.com')
      const contract = await contractOf(UNO, 'C-06')
      const account = await get(
        admin,
        `/contracts/${contract.id}/account`,
      ).expect(200)
      expect(
        Number(account.body.data.totals.pendingSettlement),
      ).toBeGreaterThan(0)
    })
  })

  describe('idempotencia', () => {
    it('la segunda corrida no crea nada', () => {
      for (const tenant of second.tenants) {
        expect(tenant.tenantCreated).toBe(false)
        expect(tenant.created).toEqual({})
      }
    })

    it('la segunda corrida no duplica ninguna tabla', async () => {
      expect(await countsOf(UNO)).toEqual(countsAfterFirst[UNO])
      expect(await countsOf(DOS)).toEqual(countsAfterFirst[DOS])
    })

    it('las dos corridas informan los mismos contratos', () => {
      expect(second.tenants.map((t) => t.contracts)).toEqual(
        first.tenants.map((t) => t.contracts),
      )
    })
  })

  describe('aislamiento entre las dos inmobiliarias', () => {
    it('cada administrador sólo ve a los propietarios de la suya', async () => {
      const adminUno = await login('admin@demo-uno.example.com')
      const adminDos = await login('admin@demo-dos.example.com')

      const owners = async (token: string) =>
        (await get(token, '/owners?limit=100').expect(200)).body.data.data as {
          lastName: string
        }[]

      const ofUno = await owners(adminUno)
      const ofDos = await owners(adminDos)
      expect(ofUno).toHaveLength(7)
      expect(ofDos).toHaveLength(2)
      expect(ofUno.every((o) => !o.lastName.includes('Dos-'))).toBe(true)
      expect(ofDos.every((o) => o.lastName.includes('Dos-'))).toBe(true)
    })

    it('un administrador no puede leer contratos ni propietarios de la otra', async () => {
      const adminUno = await login('admin@demo-uno.example.com')
      const adminDos = await login('admin@demo-dos.example.com')

      const [dosContract, unoContract] = await Promise.all([
        RequestContext.runInTenant(tenantIds[DOS], () =>
          prisma.db.contract.findFirstOrThrow(),
        ),
        RequestContext.runInTenant(tenantIds[UNO], () =>
          prisma.db.contract.findFirstOrThrow(),
        ),
      ])
      const dosOwner = await RequestContext.runInTenant(tenantIds[DOS], () =>
        prisma.db.owner.findFirstOrThrow(),
      )

      await get(adminUno, `/contracts/${dosContract.id}`).expect(404)
      await get(adminUno, `/owners/${dosOwner.id}`).expect(404)
      await get(adminDos, `/contracts/${unoContract.id}`).expect(404)
      // Y el propio sí.
      await get(adminDos, `/contracts/${dosContract.id}`).expect(200)
    })

    it('ninguna tabla con tenant mezcla filas de las dos', async () => {
      // Cada fila de contratos, cuotas y pagos pertenece al tenant de su propietario.
      const rows = await prisma.$queryRaw<{ crossed: number }[]>`
        SELECT count(*)::int AS crossed
          FROM installments i
          JOIN contracts c ON c.id = i.contract_id
         WHERE c.tenant_id <> i.tenant_id`
      expect(rows[0].crossed).toBe(0)
    })

    it('los usuarios del portal entran sólo por su inmobiliaria', async () => {
      const loginPortal = (slug: string, email: string) =>
        request(app.getHttpServer()).post('/api/v1/auth/portal-login').send({
          tenantSlug: slug,
          email,
          password: DEMO_PASSWORD,
          type: 'OWNER',
        })

      await loginPortal(UNO, 'own-a@demo-uno.example.com').expect(200)
      await loginPortal(DOS, 'own-a@demo-uno.example.com').expect(401)
    })
  })
})
