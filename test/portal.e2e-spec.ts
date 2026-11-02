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

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'
const today = todayIso()
const period = periodOf(today)
const previous = periodOf(addMonths(today, -1))

/**
 * Portales de inquilinos y propietarios (Fases 17 y 18): cada usuario ve sólo
 * lo suyo, dentro de su inmobiliaria y entre usuarios de la misma.
 */
describe('Portales de inquilinos y propietarios (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string }
  let tenantB: { id: string }
  let adminToken: string
  let adminBToken: string
  let master: { tolosa: string; casa: string }
  let masterB: { tolosa: string; casa: string }

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
  const nextId = () => String(70_000_000 + ++counter)

  interface Scenario {
    contractId: string
    ownerId: string
    renterId: string
    propertyId: string
    installmentId: string
    paymentId: string
    settlementId: string
  }

  const createContract = async (
    token: string,
    mastered: typeof master,
    overrides: Record<string, unknown> = {},
  ) => {
    const owner = await api(token)
      .post('/owners')
      .send({
        firstName: 'Ana',
        lastName: `Gómez ${counter}`,
        nationalId: nextId(),
        email: `owner${counter}@mail.com`,
        bankAccount: { cbu: '0110599552000000123456' },
      })
      .expect(201)
    const property = await api(token)
      .post('/properties')
      .send({
        address: `Calle ${++counter} 100`,
        locationId: mastered.tolosa,
        propertyTypeId: mastered.casa,
        ownerId: owner.body.data.id,
      })
      .expect(201)
    const renter = await api(token)
      .post('/renters')
      .send({
        firstName: 'Iván',
        lastName: `López ${counter}`,
        nationalId: nextId(),
      })
      .expect(201)
    const contract = await api(token)
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
        lateFeeGraceDays: 90,
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

  /** Paga entera la cuota del mes pasado: dispara recibo y liquidación pendiente. */
  const payInstallment = async (token: string, contractId: string) => {
    await api(token)
      .post('/billing/installments/generate')
      .send({ period: previous })
      .expect(200)
    const installments = await api(token)
      .get(`/billing/installments?contractId=${contractId}&period=${previous}`)
      .expect(200)
    const installment = installments.body.data.data[0]
    const req = api(token).post(
      `/billing/installments/${installment.id}/payments`,
    )
    for (const [key, value] of Object.entries({
      paidCurrency: 'ARS',
      method: 'TRANSFER',
      paidAt: `${previous}-05`,
      amount: '100000',
    })) {
      req.field(key, value)
    }
    const response = await req.expect(201)
    return {
      installmentId: installment.id as string,
      paymentId: response.body.data.payment.id as string,
    }
  }

  /** Contrato pagado y liquidación confirmada, lista para el portal. */
  const scenario = async (
    token: string,
    mastered: typeof master,
    overrides: Record<string, unknown> = {},
  ): Promise<Scenario> => {
    const contract = await createContract(token, mastered, overrides)
    const payment = await payInstallment(token, contract.contractId)
    let settlementId = ''
    await waitFor(async () => {
      const list = await api(token)
        .get(`/settlements?contractId=${contract.contractId}`)
        .expect(200)
      settlementId = list.body.data.data[0]?.id ?? ''
      return settlementId !== ''
    })
    return { ...contract, ...payment, settlementId }
  }

  const confirm = (settlementId: string) =>
    api(adminToken).post(`/settlements/${settlementId}/confirm`).expect(200)

  const transfer = (settlementId: string, amount: string) =>
    api(adminToken)
      .post(`/settlements/${settlementId}/transfers`)
      .field('transferredAt', today)
      .field('method', 'TRANSFER')
      .field('amount', amount)
      .expect(201)

  /** Un usuario de portal vinculado a la ficha del propietario o inquilino. */
  const portalUser = async (
    tenantId: string,
    slug: string,
    email: string,
    kind: 'OWNER' | 'RENTER',
    personId: string | null,
  ) => {
    const user = await createUser(prisma, {
      tenantId,
      email,
      role: kind === 'OWNER' ? Role.OWNER : Role.RENTER,
    })
    if (personId && kind === 'OWNER') {
      await prisma.owner.update({
        where: { id: personId },
        data: { portalUserId: user.id },
      })
    }
    if (personId && kind === 'RENTER') {
      await prisma.renter.update({
        where: { id: personId },
        data: { portalUserId: user.id },
      })
    }
    return loginToPortalAs(app, slug, email, kind)
  }

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
    await createUser(prisma, {
      tenantId: tenantB.id,
      email: 'admin@b.com',
      role: Role.ADMIN,
    })
    adminToken = await loginAs(app, 'admin@a.com')
    adminBToken = await loginAs(app, 'admin@b.com')
    const masterOf = async (tenantId: string) => ({
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
    master = await masterOf(tenantA.id)
    masterB = await masterOf(tenantB.id)
    await prisma.tenant.update({
      where: { id: tenantA.id },
      data: {
        phone: '2215550000',
        whatsapp: '5492215550000',
        bankAccountHolder: 'Oppido SRL',
        bankName: 'Banco Provincia',
        bankCbu: '0140000000000000000001',
        bankAlias: 'oppido.alquileres',
      },
    })
  })

  describe('inquilino', () => {
    it('ve su perfil, su contrato y su estado de cuenta, y nada de los honorarios ni de quién registró', async () => {
      const mine = await scenario(adminToken, master)
      await api(adminToken)
        .post('/billing/installments/generate')
        .send({ period })
        .expect(200)
      const token = await portalUser(
        tenantA.id,
        'tenant-a',
        'renter@a.com',
        'RENTER',
        mine.renterId,
      )

      const me = await api(token).get('/portal/renter/me').expect(200)
      expect(me.body.data).toMatchObject({
        id: mine.renterId,
        agency: {
          slug: 'tenant-a',
          whatsapp: '5492215550000',
          bankAccount: {
            holder: 'Oppido SRL',
            cbu: '0140000000000000000001',
            alias: 'oppido.alquileres',
          },
        },
      })

      const contract = await api(token)
        .get('/portal/renter/contract')
        .expect(200)
      expect(contract.body.data).toMatchObject({
        id: mine.contractId,
        status: 'ACTIVE',
        currentRent: '100000.00',
        currency: 'ARS',
        collectionMode: 'AGENCY',
        guarantor: null,
        surety: { hasSurety: false },
        feePaidByRenter: null,
        property: { id: mine.propertyId, propertyType: 'Casa' },
        timeline: { totalMonths: 24 },
      })
      expect(Array.isArray(contract.body.data.services)).toBe(true)

      const account = await api(token).get('/portal/renter/account').expect(200)
      expect(account.body.data.contract).toEqual({
        id: mine.contractId,
        status: 'ACTIVE',
      })
      expect(account.body.data.currentInstallment).toMatchObject({
        period,
        baseAmount: '100000.00',
        totalDue: '100000.00',
        owner: null,
        feePercentage: '0.00',
        feeAmount: null,
        feeOnBase: '0.00',
        notes: null,
      })
      expect(account.body.data.arrears.status).toBe('PENDING')
      expect(account.body.data.paymentInstructions).toMatchObject({
        kind: 'AGENCY',
        bankAccount: { alias: 'oppido.alquileres' },
      })

      const list = await api(token)
        .get('/portal/renter/installments?limit=1')
        .expect(200)
      expect(list.body.data.pagination).toMatchObject({ total: 2, limit: 1 })
      expect(list.body.data.data[0]).toMatchObject({ period, owner: null })

      const detail = await api(token)
        .get(`/portal/renter/installments/${mine.installmentId}`)
        .expect(200)
      expect(detail.body.data).toMatchObject({
        status: 'PAID',
        owner: null,
        notes: null,
        feePercentage: '0.00',
      })
      expect(detail.body.data.payments).toHaveLength(1)
      expect(detail.body.data.payments[0]).toMatchObject({
        id: mine.paymentId,
        registeredBy: null,
        confirmedBy: null,
        voidedBy: null,
        notes: null,
        settlementId: null,
      })
    })

    it('si paga los honorarios por cuenta del propietario los ve; si cobra el propietario, no ve los datos bancarios', async () => {
      const onBehalf = await createContract(adminToken, master, {
        feeMode: 'RENTER_PAYS_ON_BEHALF',
      })
      const direct = await createContract(adminToken, master, {
        collectionMode: 'OWNER_DIRECT',
      })
      const onBehalfToken = await portalUser(
        tenantA.id,
        'tenant-a',
        'behalf@a.com',
        'RENTER',
        onBehalf.renterId,
      )
      const directToken = await portalUser(
        tenantA.id,
        'tenant-a',
        'direct@a.com',
        'RENTER',
        direct.renterId,
      )

      const behalfContract = await api(onBehalfToken)
        .get('/portal/renter/contract')
        .expect(200)
      expect(behalfContract.body.data.feePaidByRenter).toMatchObject({
        feePercentage: expect.any(String),
      })

      const account = await api(directToken)
        .get('/portal/renter/account')
        .expect(200)
      expect(account.body.data.paymentInstructions).toEqual({
        kind: 'OWNER_DIRECT',
        bankAccount: null,
      })
      const directContract = await api(directToken)
        .get('/portal/renter/contract')
        .expect(200)
      expect(directContract.body.data.feePaidByRenter).toBeNull()
      expect(directContract.body.data.collectionMode).toBe('OWNER_DIRECT')
    })

    it('no ve las cuotas ni los recibos de otro inquilino, ni los de su propietario, ni los de otra inmobiliaria', async () => {
      const mine = await scenario(adminToken, master)
      const other = await scenario(adminToken, master)
      const token = await portalUser(
        tenantA.id,
        'tenant-a',
        'renter@a.com',
        'RENTER',
        mine.renterId,
      )
      await portalUser(
        tenantA.id,
        'tenant-a',
        'renter2@a.com',
        'RENTER',
        other.renterId,
      )

      const list = await api(token)
        .get('/portal/renter/installments')
        .expect(200)
      expect(list.body.data.data.map((i: { id: string }) => i.id)).toEqual([
        mine.installmentId,
      ])
      expect(list.body.data.pagination.total).toBe(1)

      for (const id of [other.installmentId, UNKNOWN_ID]) {
        const response = await api(token)
          .get(`/portal/renter/installments/${id}`)
          .expect(404)
        expect(response.body.code).toBe('INSTALLMENT_NOT_FOUND')
      }
      const receipt = await api(token)
        .get(`/portal/renter/payments/${other.paymentId}/receipt`)
        .expect(404)
      expect(receipt.body.code).toBe('PAYMENT_NOT_FOUND')

      // Otra inmobiliaria: un inquilino de B con la ficha de B no ve nada de A.
      const inB = await createContract(adminBToken, masterB)
      const tokenB = await portalUser(
        tenantB.id,
        'tenant-b',
        'renter@b.com',
        'RENTER',
        inB.renterId,
      )
      await api(tokenB)
        .get(`/portal/renter/installments/${mine.installmentId}`)
        .expect(404)
      await api(tokenB)
        .get(`/portal/renter/payments/${mine.paymentId}/receipt`)
        .expect(404)
      const listB = await api(tokenB)
        .get('/portal/renter/installments')
        .expect(200)
      expect(listB.body.data.pagination.total).toBe(0)
      const meB = await api(tokenB).get('/portal/renter/me').expect(200)
      expect(meB.body.data.agency.slug).toBe('tenant-b')
    })

    it('baja el recibo de su pago cuando está listo: 302, o { url } con ?format=json', async () => {
      const mine = await scenario(adminToken, master)
      const token = await portalUser(
        tenantA.id,
        'tenant-a',
        'renter@a.com',
        'RENTER',
        mine.renterId,
      )
      let url = ''
      await waitFor(async () => {
        const response = await api(token).get(
          `/portal/renter/payments/${mine.paymentId}/receipt?format=json`,
        )
        if (response.status === 200) url = response.body.data.url
        return response.status === 200
      })
      expect(url).toContain('http')
      const redirect = await api(token)
        .get(`/portal/renter/payments/${mine.paymentId}/receipt`)
        .redirects(0)
        .expect(302)
      expect(redirect.headers.location).toBe(url)
    })

    it('un usuario sin ficha asociada recibe un 404 claro', async () => {
      const token = await portalUser(
        tenantA.id,
        'tenant-a',
        'orphan@a.com',
        'RENTER',
        null,
      )
      const response = await api(token).get('/portal/renter/me').expect(404)
      expect(response.body.code).toBe('PORTAL_PROFILE_NOT_FOUND')
    })

    it('sin contratos: contrato null y cuenta vacía', async () => {
      const renter = await api(adminToken)
        .post('/renters')
        .send({ firstName: 'Sin', lastName: 'Contrato', nationalId: nextId() })
        .expect(201)
      const token = await portalUser(
        tenantA.id,
        'tenant-a',
        'empty@a.com',
        'RENTER',
        renter.body.data.id,
      )
      const contract = await api(token)
        .get('/portal/renter/contract')
        .expect(200)
      expect(contract.body.data).toBeNull()
      const account = await api(token).get('/portal/renter/account').expect(200)
      expect(account.body.data).toMatchObject({
        contract: null,
        currentInstallment: null,
        creditsAvailable: [],
        arrears: { status: 'UP_TO_DATE' },
      })
    })
  })

  describe('propietario', () => {
    it('ve su perfil, sus propiedades con el estado de pago y su estado de cuenta del mes', async () => {
      const mine = await scenario(adminToken, master)
      const other = await scenario(adminToken, master)
      await api(adminToken)
        .post('/billing/installments/generate')
        .send({ period })
        .expect(200)
      await confirm(mine.settlementId)
      await transfer(mine.settlementId, '50000')
      await confirm(other.settlementId)
      const token = await portalUser(
        tenantA.id,
        'tenant-a',
        'owner@a.com',
        'OWNER',
        mine.ownerId,
      )

      const me = await api(token).get('/portal/owner/me').expect(200)
      expect(me.body.data).toMatchObject({
        id: mine.ownerId,
        statementSendMode: 'BOTH',
        bankAccount: { cbu: '0110599552000000123456' },
        agency: { slug: 'tenant-a' },
      })

      const properties = await api(token)
        .get('/portal/owner/properties')
        .expect(200)
      expect(properties.body.data).toHaveLength(1)
      expect(properties.body.data[0]).toMatchObject({
        id: mine.propertyId,
        contract: {
          id: mine.contractId,
          currentRent: '100000.00',
          collectionMode: 'AGENCY',
        },
        currentInstallment: {
          period,
          status: 'PENDING',
          totalDue: '100000.00',
        },
      })

      const account = await api(token).get('/portal/owner/account').expect(200)
      expect(account.body.data.period).toBe(period)
      expect(account.body.data.properties).toHaveLength(1)
      expect(account.body.data.properties[0]).toMatchObject({
        property: { id: mine.propertyId },
        currency: 'ARS',
        accrued: '100000.00',
        collected: '0.00',
        pending: '100000.00',
        lateFee: '0.00',
      })
      expect(account.body.data.properties[0].settlements).toHaveLength(1)
      expect(account.body.data.totals).toEqual([
        {
          currency: 'ARS',
          accrued: '100000.00',
          collected: '0.00',
          pending: '100000.00',
          netSettled: '95000.00',
          transferred: '50000.00',
        },
      ])
      expect(Array.isArray(account.body.data.fees)).toBe(true)

      const previousAccount = await api(token)
        .get(`/portal/owner/account?period=${previous}`)
        .expect(200)
      expect(previousAccount.body.data.totals[0]).toMatchObject({
        accrued: '100000.00',
        collected: '100000.00',
        pending: '0.00',
      })
      await api(token).get('/portal/owner/account?period=2026-13').expect(400)
    })

    it('ve sólo sus liquidaciones confirmadas, enmascaradas, y las ajenas no existen', async () => {
      const mine = await scenario(adminToken, master)
      const other = await scenario(adminToken, master)
      await confirm(mine.settlementId)
      await confirm(other.settlementId)
      const token = await portalUser(
        tenantA.id,
        'tenant-a',
        'owner@a.com',
        'OWNER',
        mine.ownerId,
      )

      const list = await api(token).get('/portal/owner/settlements').expect(200)
      expect(list.body.data.data.map((s: { id: string }) => s.id)).toEqual([
        mine.settlementId,
      ])
      const filtered = await api(token)
        .get(
          `/portal/owner/settlements?propertyId=${mine.propertyId}&period=${period}`,
        )
        .expect(200)
      expect(filtered.body.data.pagination.total).toBe(1)
      const none = await api(token)
        .get(`/portal/owner/settlements?propertyId=${other.propertyId}`)
        .expect(200)
      expect(none.body.data.pagination.total).toBe(0)

      const detail = await api(token)
        .get(`/portal/owner/settlements/${mine.settlementId}`)
        .expect(200)
      expect(detail.body.data).toMatchObject({
        id: mine.settlementId,
        status: 'CONFIRMED',
        netAmount: '95000.00',
        acknowledgedAt: null,
        confirmedBy: null,
        notes: null,
        cancelReason: null,
      })

      for (const id of [other.settlementId, UNKNOWN_ID]) {
        const response = await api(token)
          .get(`/portal/owner/settlements/${id}`)
          .expect(404)
        expect(response.body.code).toBe('SETTLEMENT_NOT_FOUND')
        await api(token).get(`/portal/owner/settlements/${id}/pdf`).expect(404)
        await api(token)
          .post(`/portal/owner/settlements/${id}/acknowledge`)
          .expect(404)
      }
    })

    it('un borrador sin confirmar no existe para el propietario', async () => {
      const mine = await scenario(adminToken, master)
      const token = await portalUser(
        tenantA.id,
        'tenant-a',
        'owner@a.com',
        'OWNER',
        mine.ownerId,
      )
      const list = await api(token).get('/portal/owner/settlements').expect(200)
      expect(list.body.data.pagination.total).toBe(0)
      await api(token)
        .get(`/portal/owner/settlements/${mine.settlementId}`)
        .expect(404)
      await api(token)
        .post(`/portal/owner/settlements/${mine.settlementId}/acknowledge`)
        .expect(404)
    })

    it('acusa recibo de la transferencia: sólo con una transferencia, una vez, sin cambiar la liquidación', async () => {
      const mine = await scenario(adminToken, master)
      const other = await scenario(adminToken, master)
      await confirm(mine.settlementId)
      await confirm(other.settlementId)
      const token = await portalUser(
        tenantA.id,
        'tenant-a',
        'owner@a.com',
        'OWNER',
        mine.ownerId,
      )
      const otherToken = await portalUser(
        tenantA.id,
        'tenant-a',
        'owner2@a.com',
        'OWNER',
        other.ownerId,
      )

      const early = await api(token)
        .post(`/portal/owner/settlements/${mine.settlementId}/acknowledge`)
        .expect(422)
      expect(early.body.code).toBe('SETTLEMENT_NOTHING_TO_ACKNOWLEDGE')

      await transfer(mine.settlementId, '95000')
      // Otro propietario de la misma inmobiliaria no puede acusar la mía.
      await api(otherToken)
        .post(`/portal/owner/settlements/${mine.settlementId}/acknowledge`)
        .expect(404)

      const first = await api(token)
        .post(`/portal/owner/settlements/${mine.settlementId}/acknowledge`)
        .expect(200)
      expect(first.body.data).toMatchObject({
        status: 'TRANSFERRED',
        transferredTotal: '95000.00',
      })
      expect(first.body.data.acknowledgedAt).not.toBeNull()
      const second = await api(token)
        .post(`/portal/owner/settlements/${mine.settlementId}/acknowledge`)
        .expect(200)
      expect(second.body.data.acknowledgedAt).toBe(
        first.body.data.acknowledgedAt,
      )

      // El personal también lo ve.
      const staff = await api(adminToken)
        .get(`/settlements/${mine.settlementId}`)
        .expect(200)
      expect(staff.body.data.acknowledgedAt).toBe(
        first.body.data.acknowledgedAt,
      )
      const untouched = await api(adminToken)
        .get(`/settlements/${other.settlementId}`)
        .expect(200)
      expect(untouched.body.data.acknowledgedAt).toBeNull()
    })

    it('baja el PDF de su liquidación y de su resumen mensual; el resumen abierto no existe', async () => {
      const mine = await scenario(adminToken, master)
      await confirm(mine.settlementId)
      const token = await portalUser(
        tenantA.id,
        'tenant-a',
        'owner@a.com',
        'OWNER',
        mine.ownerId,
      )

      let url = ''
      await waitFor(async () => {
        const response = await api(token).get(
          `/portal/owner/settlements/${mine.settlementId}/pdf?format=json`,
        )
        if (response.status === 200) url = response.body.data.url
        return response.status === 200
      })
      const redirect = await api(token)
        .get(`/portal/owner/settlements/${mine.settlementId}/pdf`)
        .redirects(0)
        .expect(302)
      expect(redirect.headers.location).toBe(url)

      const statement = await api(adminToken)
        .post('/statements')
        .send({ ownerId: mine.ownerId, period })
        .expect(201)
      const statementId = statement.body.data.id as string
      await api(adminToken)
        .post(`/statements/${statementId}/settlements`)
        .send({ settlementIds: [mine.settlementId] })
        .expect(200)

      // Abierto es un borrador: no se ve.
      const open = await api(token).get('/portal/owner/statements').expect(200)
      expect(open.body.data.pagination.total).toBe(0)
      await api(token)
        .get(`/portal/owner/statements/${statementId}`)
        .expect(404)

      await api(adminToken)
        .post(`/statements/${statementId}/close`)
        .send({ sendMode: 'SUMMARY' })
        .expect(200)
      const closed = await api(token)
        .get('/portal/owner/statements')
        .expect(200)
      expect(closed.body.data.data).toHaveLength(1)
      expect(closed.body.data.data[0]).toMatchObject({
        id: statementId,
        status: 'CLOSED',
        period,
      })
      const detail = await api(token)
        .get(`/portal/owner/statements/${statementId}`)
        .expect(200)
      expect(detail.body.data).toMatchObject({
        closedBy: null,
        notes: null,
      })
      expect(detail.body.data.settlements).toHaveLength(1)

      let statementUrl = ''
      await waitFor(async () => {
        const response = await api(token).get(
          `/portal/owner/statements/${statementId}/pdf?format=json`,
        )
        if (response.status === 200) statementUrl = response.body.data.url
        return response.status === 200
      })
      expect(statementUrl).toContain('http')
    })

    it('ve el historial de pagos del inquilino de su propiedad, no el de una ajena', async () => {
      const mine = await scenario(adminToken, master)
      const other = await scenario(adminToken, master)
      const token = await portalUser(
        tenantA.id,
        'tenant-a',
        'owner@a.com',
        'OWNER',
        mine.ownerId,
      )
      const history = await api(token)
        .get(`/portal/owner/properties/${mine.propertyId}/installments`)
        .expect(200)
      expect(history.body.data.data).toHaveLength(1)
      expect(history.body.data.data[0]).toMatchObject({
        id: mine.installmentId,
        period: previous,
        status: 'PAID',
      })
      expect(history.body.data.data[0].payments).toBeUndefined()

      for (const propertyId of [other.propertyId, UNKNOWN_ID]) {
        const response = await api(token)
          .get(`/portal/owner/properties/${propertyId}/installments`)
          .expect(404)
        expect(response.body.code).toBe('PROPERTY_NOT_FOUND')
      }
    })

    it('no ve nada de otra inmobiliaria y no recibe los honorarios de otros propietarios', async () => {
      const mine = await scenario(adminToken, master)
      const other = await scenario(adminToken, master)
      await confirm(mine.settlementId)
      await confirm(other.settlementId)
      const token = await portalUser(
        tenantA.id,
        'tenant-a',
        'owner@a.com',
        'OWNER',
        mine.ownerId,
      )
      const account = await api(token)
        .get(`/portal/owner/account?period=${period}`)
        .expect(200)
      // Los honorarios son los de su cuenta: ni los de la otra liquidación ni el total de la inmobiliaria.
      const settled = account.body.data.totals[0]
      expect(settled.netSettled).toBe('95000.00')
      expect(JSON.stringify(account.body.data)).not.toContain(other.propertyId)

      const inB = await createContract(adminBToken, masterB)
      const tokenB = await portalUser(
        tenantB.id,
        'tenant-b',
        'owner@b.com',
        'OWNER',
        inB.ownerId,
      )
      await api(tokenB)
        .get(`/portal/owner/settlements/${mine.settlementId}`)
        .expect(404)
      await api(tokenB)
        .get(`/portal/owner/properties/${mine.propertyId}/installments`)
        .expect(404)
      const listB = await api(tokenB)
        .get('/portal/owner/settlements')
        .expect(200)
      expect(listB.body.data.pagination.total).toBe(0)
      const propertiesB = await api(tokenB)
        .get('/portal/owner/properties')
        .expect(200)
      expect(propertiesB.body.data.map((p: { id: string }) => p.id)).toEqual([
        inB.propertyId,
      ])
    })
  })

  describe('roles', () => {
    it('cada portal es sólo de su rol, y el personal no entra', async () => {
      const mine = await scenario(adminToken, master)
      const ownerToken = await portalUser(
        tenantA.id,
        'tenant-a',
        'owner@a.com',
        'OWNER',
        mine.ownerId,
      )
      const renterToken = await portalUser(
        tenantA.id,
        'tenant-a',
        'renter@a.com',
        'RENTER',
        mine.renterId,
      )
      await api(ownerToken).get('/portal/renter/me').expect(403)
      await api(renterToken).get('/portal/owner/me').expect(403)
      await api(adminToken).get('/portal/renter/me').expect(403)
      await api(adminToken).get('/portal/owner/properties').expect(403)
      await request(app.getHttpServer())
        .get('/api/v1/portal/owner/me')
        .expect(401)
    })

    it('el acuse no deja pasar al inquilino', async () => {
      const mine = await scenario(adminToken, master)
      await confirm(mine.settlementId)
      const renterToken = await portalUser(
        tenantA.id,
        'tenant-a',
        'renter@a.com',
        'RENTER',
        mine.renterId,
      )
      await api(renterToken)
        .post(`/portal/owner/settlements/${mine.settlementId}/acknowledge`)
        .expect(403)
    })
  })
})
