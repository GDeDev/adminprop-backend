import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import request from 'supertest'

import { seedBaseMasterData } from '../prisma/lib/master-data-seed'
import { ServicesFacade } from '../src/modules/services/public'
import { RequestContext } from '../src/shared/context/request-context'
import { addDays, addMonths, todayIso } from '../src/shared/dates/calendar-date'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'

const PDF = Buffer.from('%PDF-1.4 comprobante')
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'
const SETTLEMENT_ID = '11111111-1111-4111-8111-111111111111'

const today = todayIso()

/** Servicios y gastos adelantados (spec Fase 10): criterios, casos borde y aislamiento. */
describe('Servicios y gastos adelantados (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string }
  let tenantB: { id: string }
  let admin: { id: string }
  let adminToken: string
  let employeeToken: string
  let adminBToken: string
  let refs: { tolosa: string; casa: string; luz: string; gas: string }
  let refsB: { tolosa: string; casa: string; luz: string; gas: string }

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
  const nextId = () => String(30_000_000 + ++counter)

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

  /** Una propiedad con su contrato activo. */
  const createContract = async (token = adminToken, master = refs) => {
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
      })
      .expect(201)
    return { id: response.body.data.id as string, propertyId, renterId }
  }

  const serviceBody = (overrides: Record<string, unknown> = {}) => ({
    serviceTypeId: refs.luz,
    paidBy: 'RENTER',
    currency: 'ARS',
    hasDueDate: false,
    hasIncrease: false,
    managedByAgency: true,
    ...overrides,
  })

  const createService = async (
    propertyId: string,
    overrides: Record<string, unknown> = {},
    token = adminToken,
  ) => {
    const response = await api(token)
      .post(`/properties/${propertyId}/services`)
      .send(serviceBody(overrides))
      .expect(201)
    return response.body.data
  }

  const createExpense = async (
    contractId: string,
    fields: Record<string, string> = {},
    token = adminToken,
  ) => {
    const req = api(token)
      .post(`/contracts/${contractId}/advance-expenses`)
      .field('amount', fields.amount ?? '1500')
      .field('description', fields.description ?? 'Arreglo de canilla')
      .field('expenseDate', fields.expenseDate ?? addDays(today, -3))
    if (fields.currency) req.field('currency', fields.currency)
    const response = await req
      .attach('file', PDF, {
        filename: 'ticket.pdf',
        contentType: 'application/pdf',
      })
      .expect(201)
    return response.body.data
  }

  const inTenantA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ correlationId: 'test' }, () =>
      RequestContext.runInTenant(tenantA.id, fn),
    )

  const markSettled = (ids: string[]) =>
    inTenantA(() =>
      app.get(ServicesFacade).markExpensesSettled(ids, SETTLEMENT_ID),
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
    admin = await createUser(prisma, {
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

    const master = async (tenantId: string) => {
      const find = async (
        table: 'location' | 'propertyType' | 'serviceType',
        name: string,
      ) => {
        const row =
          table === 'location'
            ? await prisma.location.findFirstOrThrow({
                where: { tenantId, name },
              })
            : table === 'propertyType'
              ? await prisma.propertyType.findFirstOrThrow({
                  where: { tenantId, name },
                })
              : await prisma.serviceType.findFirstOrThrow({
                  where: { tenantId, name },
                })
        return row.id
      }
      return {
        tolosa: await find('location', 'Tolosa'),
        casa: await find('propertyType', 'Casa'),
        luz: await find('serviceType', 'Luz'),
        gas: await find('serviceType', 'Gas'),
      }
    }
    refs = await master(tenantA.id)
    refsB = await master(tenantB.id)
  })

  describe('servicios: alta (spec 3.1)', () => {
    it('crea un servicio de la propiedad y uno del contrato, al día', async () => {
      const { id: contractId, propertyId } = await createContract()

      const ofProperty = await createService(
        propertyId,
        { notes: '  Medidor en el frente ' },
        employeeToken,
      )
      expect(ofProperty).toMatchObject({
        propertyId,
        contractId: null,
        serviceType: { id: refs.luz, name: 'Luz', isActive: true },
        paidBy: 'RENTER',
        currency: 'ARS',
        hasDueDate: false,
        dueDate: null,
        hasIncrease: false,
        increaseFrequency: null,
        managedByAgency: true,
        notes: 'Medidor en el frente',
        status: 'UP_TO_DATE',
        daysOverdue: 0,
      })

      const ofContract = await createService(propertyId, {
        contractId,
        serviceTypeId: refs.gas,
        paidBy: 'OWNER',
        hasDueDate: true,
        dueDate: addDays(today, 10),
        hasIncrease: true,
        increaseFrequency: 'QUARTERLY',
      })
      expect(ofContract).toMatchObject({
        contractId,
        serviceType: { name: 'Gas' },
        paidBy: 'OWNER',
        hasDueDate: true,
        dueDate: addDays(today, 10),
        hasIncrease: true,
        increaseFrequency: 'QUARTERLY',
        status: 'UP_TO_DATE',
        daysOverdue: 0,
      })

      const list = await api(employeeToken)
        .get(`/properties/${propertyId}/services`)
        .expect(200)
      expect(list.body.data.map((s: { id: string }) => s.id)).toEqual([
        ofProperty.id,
        ofContract.id,
      ])

      const filtered = await api(employeeToken)
        .get(`/properties/${propertyId}/services?contractId=${contractId}`)
        .expect(200)
      expect(filtered.body.data.map((s: { id: string }) => s.id)).toEqual([
        ofContract.id,
      ])
    })

    it('con vencimiento sin fecha → 400; con aumento sin frecuencia → 400', async () => {
      const propertyId = await createProperty()

      const noDate = await api(adminToken)
        .post(`/properties/${propertyId}/services`)
        .send(serviceBody({ hasDueDate: true }))
        .expect(400)
      expect(noDate.body.code).toBe('SERVICE_DUE_DATE_REQUIRED')

      const noFrequency = await api(adminToken)
        .post(`/properties/${propertyId}/services`)
        .send(serviceBody({ hasIncrease: true }))
        .expect(400)
      expect(noFrequency.body.code).toBe('SERVICE_INCREASE_FREQUENCY_REQUIRED')

      const badDate = await api(adminToken)
        .post(`/properties/${propertyId}/services`)
        .send(serviceBody({ hasDueDate: true, dueDate: '2026-02-30' }))
        .expect(400)
      expect(badDate.body.code).toBe('SERVICE_INVALID_DATE')
    })

    it('sin vencimiento descarta la fecha: no queda un servicio "vencido" por una fecha vieja', async () => {
      const propertyId = await createProperty()
      const service = await createService(propertyId, {
        hasDueDate: false,
        dueDate: '2020-01-01',
      })
      expect(service.dueDate).toBeNull()
      expect(service.status).toBe('UP_TO_DATE')
    })

    it('tipo de servicio de otra inmobiliaria o desactivado → 422', async () => {
      const propertyId = await createProperty()

      const foreign = await api(adminToken)
        .post(`/properties/${propertyId}/services`)
        .send(serviceBody({ serviceTypeId: refsB.luz }))
        .expect(422)
      expect(foreign.body.code).toBe('SERVICE_INVALID_SERVICE_TYPE')

      await prisma.serviceType.update({
        where: { id: refs.gas },
        data: { isActive: false },
      })
      const inactive = await api(adminToken)
        .post(`/properties/${propertyId}/services`)
        .send(serviceBody({ serviceTypeId: refs.gas }))
        .expect(422)
      expect(inactive.body.code).toBe('SERVICE_INVALID_SERVICE_TYPE')
    })

    it('contrato de otra propiedad → 422; propiedad inexistente → 422', async () => {
      const { id: contractId } = await createContract()
      const otherPropertyId = await createProperty()

      const wrongContract = await api(adminToken)
        .post(`/properties/${otherPropertyId}/services`)
        .send(serviceBody({ contractId }))
        .expect(422)
      expect(wrongContract.body.code).toBe('SERVICE_INVALID_CONTRACT')

      const unknownContract = await api(adminToken)
        .post(`/properties/${otherPropertyId}/services`)
        .send(serviceBody({ contractId: UNKNOWN_ID }))
        .expect(422)
      expect(unknownContract.body.code).toBe('SERVICE_INVALID_CONTRACT')

      const unknownProperty = await api(adminToken)
        .post(`/properties/${UNKNOWN_ID}/services`)
        .send(serviceBody())
        .expect(422)
      expect(unknownProperty.body.code).toBe('SERVICE_INVALID_PROPERTY')

      const list = await api(adminToken)
        .get(`/properties/${UNKNOWN_ID}/services`)
        .expect(404)
      expect(list.body.code).toBe('SERVICE_PROPERTY_NOT_FOUND')
    })
  })

  describe('servicios vencidos (spec 4, 6)', () => {
    it('un servicio con vencimiento pasado aparece vencido, con los días de atraso, los más atrasados primero', async () => {
      const propertyA = await createProperty()
      const propertyB = await createProperty()
      const yesterday = await createService(propertyA, {
        hasDueDate: true,
        dueDate: addDays(today, -1),
      })
      const tenDaysAgo = await createService(propertyB, {
        serviceTypeId: refs.gas,
        hasDueDate: true,
        dueDate: addDays(today, -10),
      })
      // Hoy todavía está al día, y sin vencimiento nunca vence.
      await createService(propertyA, { hasDueDate: true, dueDate: today })
      await createService(propertyA, { hasDueDate: false })

      expect(yesterday).toMatchObject({ status: 'OVERDUE', daysOverdue: 1 })

      const overdue = await api(employeeToken)
        .get('/services/overdue')
        .expect(200)
      expect(overdue.body.data.pagination.total).toBe(2)
      expect(overdue.body.data.data.map((s: { id: string }) => s.id)).toEqual([
        tenDaysAgo.id,
        yesterday.id,
      ])
      expect(overdue.body.data.data[0]).toMatchObject({
        status: 'OVERDUE',
        daysOverdue: 10,
        serviceType: { name: 'Gas' },
        property: { id: propertyB, address: expect.any(String) },
      })

      const filtered = await api(employeeToken)
        .get(`/services/overdue?propertyId=${propertyA}`)
        .expect(200)
      expect(filtered.body.data.data.map((s: { id: string }) => s.id)).toEqual([
        yesterday.id,
      ])

      // La facade que va a usar el cron de la Fase 13 (RN-13).
      const fromFacade = await inTenantA(() =>
        app.get(ServicesFacade).listOverdue(),
      )
      expect(fromFacade.map((s) => [s.id, s.daysOverdue])).toEqual([
        [tenDaysAgo.id, 10],
        [yesterday.id, 1],
      ])
    })
  })

  describe('servicios de un contrato (D-66)', () => {
    it('mezcla los del contrato con los heredados de la propiedad, con su scope', async () => {
      const { id: contractId, propertyId } = await createContract()
      const inherited = await createService(propertyId)
      const own = await createService(propertyId, {
        contractId,
        serviceTypeId: refs.gas,
      })

      const list = await api(employeeToken)
        .get(`/contracts/${contractId}/services`)
        .expect(200)
      expect(
        list.body.data.map((s: { id: string; scope: string }) => [
          s.id,
          s.scope,
        ]),
      ).toEqual([
        [inherited.id, 'PROPERTY'],
        [own.id, 'CONTRACT'],
      ])

      const unknown = await api(employeeToken)
        .get(`/contracts/${UNKNOWN_ID}/services`)
        .expect(404)
      expect(unknown.body.code).toBe('SERVICE_CONTRACT_NOT_FOUND')
    })

    it('los de otro contrato de la misma propiedad no se mezclan', async () => {
      const { id: original, propertyId } = await createContract()
      const renewed = await api(adminToken)
        .post(`/contracts/${original}/renew`)
        .send({ startDate: today, endDate: addMonths(today, 12) })
        .expect(201)
      const renewedId: string = renewed.body.data.id

      const ofOriginal = await createService(propertyId, {
        contractId: original,
      })
      const ofRenewed = await createService(propertyId, {
        contractId: renewedId,
        serviceTypeId: refs.gas,
      })

      const list = await api(adminToken)
        .get(`/contracts/${renewedId}/services`)
        .expect(200)
      expect(list.body.data.map((s: { id: string }) => s.id)).toEqual([
        ofRenewed.id,
      ])
      expect(list.body.data.map((s: { id: string }) => s.id)).not.toContain(
        ofOriginal.id,
      )
    })
  })

  describe('servicios: edición y baja (spec 3.1)', () => {
    it('edita todo menos la propiedad, validando el resultado', async () => {
      const { id: contractId, propertyId } = await createContract()
      const service = await createService(propertyId)

      const updated = await api(employeeToken)
        .patch(`/services/${service.id}`)
        .send({
          contractId,
          paidBy: 'OWNER',
          hasDueDate: true,
          dueDate: addDays(today, -4),
          notes: 'Pagado por el dueño',
        })
        .expect(200)
      expect(updated.body.data).toMatchObject({
        contractId,
        paidBy: 'OWNER',
        hasDueDate: true,
        dueDate: addDays(today, -4),
        notes: 'Pagado por el dueño',
        status: 'OVERDUE',
        daysOverdue: 4,
      })

      // Sacar el vencimiento limpia la fecha; ponerlo sin fecha es error.
      const cleared = await api(employeeToken)
        .patch(`/services/${service.id}`)
        .send({ hasDueDate: false })
        .expect(200)
      expect(cleared.body.data).toMatchObject({
        hasDueDate: false,
        dueDate: null,
        status: 'UP_TO_DATE',
      })
      const noDate = await api(employeeToken)
        .patch(`/services/${service.id}`)
        .send({ hasDueDate: true })
        .expect(400)
      expect(noDate.body.code).toBe('SERVICE_DUE_DATE_REQUIRED')

      const foreignType = await api(employeeToken)
        .patch(`/services/${service.id}`)
        .send({ serviceTypeId: refsB.gas })
        .expect(422)
      expect(foreignType.body.code).toBe('SERVICE_INVALID_SERVICE_TYPE')

      const otherProperty = await createProperty()
      const otherContract = await createContract()
      const wrongContract = await api(employeeToken)
        .patch(`/services/${service.id}`)
        .send({ contractId: otherContract.id })
        .expect(422)
      expect(wrongContract.body.code).toBe('SERVICE_INVALID_CONTRACT')
      expect(otherProperty).toBeDefined()
    })

    it('la baja es lógica: el servicio desaparece de los listados', async () => {
      const propertyId = await createProperty()
      const service = await createService(propertyId, {
        hasDueDate: true,
        dueDate: addDays(today, -1),
      })

      await api(employeeToken).delete(`/services/${service.id}`).expect(204)

      const list = await api(adminToken)
        .get(`/properties/${propertyId}/services`)
        .expect(200)
      expect(list.body.data).toEqual([])
      const overdue = await api(adminToken).get('/services/overdue').expect(200)
      expect(overdue.body.data.data).toEqual([])

      const gone = await api(adminToken)
        .patch(`/services/${service.id}`)
        .send({ notes: 'x' })
        .expect(404)
      expect(gone.body.code).toBe('SERVICE_NOT_FOUND')
      expect(
        await prisma.propertyService.findUnique({ where: { id: service.id } }),
      ).toMatchObject({ deletedAt: expect.any(Date) })
    })
  })

  describe('gastos adelantados: alta (spec 3.2, 6)', () => {
    it('sin comprobante → 400; con algo que no es imagen ni PDF → 400', async () => {
      const { id: contractId } = await createContract()

      const missing = await api(adminToken)
        .post(`/contracts/${contractId}/advance-expenses`)
        .field('amount', '1500')
        .field('description', 'Arreglo')
        .field('expenseDate', today)
        .expect(400)
      expect(missing.body.code).toBe('EXPENSE_RECEIPT_REQUIRED')

      const invalid = await api(adminToken)
        .post(`/contracts/${contractId}/advance-expenses`)
        .field('amount', '1500')
        .field('description', 'Arreglo')
        .field('expenseDate', today)
        .attach('file', Buffer.from('#!/bin/sh'), {
          filename: 'ticket.pdf',
          contentType: 'application/pdf',
        })
        .expect(400)
      expect(invalid.body.code).toBe('EXPENSE_INVALID_RECEIPT')

      const list = await api(adminToken)
        .get(`/contracts/${contractId}/advance-expenses`)
        .expect(200)
      expect(list.body.data.items).toEqual([])
    })

    it('con un PDF o una foto → 201, con el comprobante, el inquilino y la moneda del contrato', async () => {
      const { id: contractId, renterId } = await createContract()

      const expense = await createExpense(
        contractId,
        { description: '  Arreglo   de canilla ' },
        employeeToken,
      )
      expect(expense).toMatchObject({
        contractId,
        renterId,
        amount: '1500.00',
        currency: 'ARS',
        description: 'Arreglo de canilla',
        expenseDate: addDays(today, -3),
        settled: false,
        settlementId: null,
        settledAt: null,
        registeredBy: { fullName: 'emp@a.com' },
      })
      expect(expense.receiptUrl).toMatch(/\.pdf$/)

      const photo = await api(adminToken)
        .post(`/contracts/${contractId}/advance-expenses`)
        .field('amount', '20.5')
        .field('description', 'Lámpara')
        .field('expenseDate', today)
        .field('currency', 'USD')
        .attach('file', JPG, {
          filename: 'foto.jpg',
          contentType: 'image/jpeg',
        })
        .expect(201)
      expect(photo.body.data).toMatchObject({
        amount: '20.50',
        currency: 'USD',
        registeredBy: { id: admin.id, fullName: 'admin@a.com' },
      })
      expect(photo.body.data.receiptUrl).toMatch(/\.jpg$/)
    })

    it('monto cero → 400; fecha inexistente → 400; contrato inexistente → 422', async () => {
      const { id: contractId } = await createContract()

      const zero = await api(adminToken)
        .post(`/contracts/${contractId}/advance-expenses`)
        .field('amount', '0')
        .field('description', 'Arreglo')
        .field('expenseDate', today)
        .attach('file', PDF, { filename: 't.pdf' })
        .expect(400)
      expect(zero.body.code).toBe('EXPENSE_INVALID_AMOUNT')

      const badDate = await api(adminToken)
        .post(`/contracts/${contractId}/advance-expenses`)
        .field('amount', '100')
        .field('description', 'Arreglo')
        .field('expenseDate', '2026-02-30')
        .attach('file', PDF, { filename: 't.pdf' })
        .expect(400)
      expect(badDate.body.code).toBe('EXPENSE_INVALID_DATE')

      const unknown = await api(adminToken)
        .post(`/contracts/${UNKNOWN_ID}/advance-expenses`)
        .field('amount', '100')
        .field('description', 'Arreglo')
        .field('expenseDate', today)
        .attach('file', PDF, { filename: 't.pdf' })
        .expect(422)
      expect(unknown.body.code).toBe('EXPENSE_INVALID_CONTRACT')

      const list = await api(adminToken)
        .get(`/contracts/${UNKNOWN_ID}/advance-expenses`)
        .expect(404)
      expect(list.body.code).toBe('EXPENSE_CONTRACT_NOT_FOUND')
    })

    it('un contrato rescindido sigue aceptando y listando gastos (spec 7)', async () => {
      const { id: contractId } = await createContract()
      await api(adminToken)
        .post(`/contracts/${contractId}/terminate`)
        .send({ notifiedAt: today })
        .expect(200)

      const expense = await createExpense(contractId)
      const list = await api(employeeToken)
        .get(`/contracts/${contractId}/advance-expenses?settled=false`)
        .expect(200)
      expect(list.body.data.items.map((e: { id: string }) => e.id)).toEqual([
        expense.id,
      ])
    })
  })

  describe('gastos adelantados: pendientes vs. descontados (spec 4, 6)', () => {
    it('el listado refleja cuáles están pendientes y cuáles descontados, con los totales del contrato', async () => {
      const { id: contractId } = await createContract()
      const pending = await createExpense(contractId, {
        amount: '1500',
        expenseDate: addDays(today, -1),
      })
      const settled = await createExpense(contractId, {
        amount: '2500.5',
        expenseDate: addDays(today, -5),
      })
      expect(await markSettled([settled.id])).toBe(1)
      // Uno ya descontado no se reasigna a otra liquidación.
      expect(await markSettled([settled.id])).toBe(0)

      const all = await api(employeeToken)
        .get(`/contracts/${contractId}/advance-expenses`)
        .expect(200)
      expect(all.body.data).toMatchObject({
        pendingTotal: '1500.00',
        settledTotal: '2500.50',
      })
      expect(
        all.body.data.items.map((e: { id: string; settled: boolean }) => [
          e.id,
          e.settled,
        ]),
      ).toEqual([
        [pending.id, false],
        [settled.id, true],
      ])
      expect(all.body.data.items[1]).toMatchObject({
        settlementId: SETTLEMENT_ID,
        settledAt: expect.any(String),
      })

      const onlySettled = await api(employeeToken)
        .get(`/contracts/${contractId}/advance-expenses?settled=true`)
        .expect(200)
      expect(
        onlySettled.body.data.items.map((e: { id: string }) => e.id),
      ).toEqual([settled.id])
      // Los totales no dependen del filtro.
      expect(onlySettled.body.data).toMatchObject({
        pendingTotal: '1500.00',
        settledTotal: '2500.50',
      })

      const onlyPending = await api(employeeToken)
        .get(`/contracts/${contractId}/advance-expenses?settled=false`)
        .expect(200)
      expect(
        onlyPending.body.data.items.map((e: { id: string }) => e.id),
      ).toEqual([pending.id])

      // La facade que va a usar la liquidación (Fase 12, RN-11).
      const forSettlement = await inTenantA(() =>
        app.get(ServicesFacade).pendingExpensesByContract(contractId),
      )
      expect(forSettlement.total).toBe('1500.00')
      expect(forSettlement.items.map((e) => e.id)).toEqual([pending.id])
    })

    it('se edita y elimina mientras está pendiente; descontado, es inmutable (409)', async () => {
      const { id: contractId } = await createContract()
      const expense = await createExpense(contractId)

      const updated = await api(employeeToken)
        .patch(`/advance-expenses/${expense.id}`)
        .send({ amount: '1800', description: 'Arreglo y repuesto' })
        .expect(200)
      expect(updated.body.data).toMatchObject({
        amount: '1800.00',
        description: 'Arreglo y repuesto',
      })

      const badAmount = await api(employeeToken)
        .patch(`/advance-expenses/${expense.id}`)
        .send({ amount: '0' })
        .expect(400)
      expect(badAmount.body.code).toBe('EXPENSE_INVALID_AMOUNT')

      await markSettled([expense.id])

      const edit = await api(adminToken)
        .patch(`/advance-expenses/${expense.id}`)
        .send({ description: 'Otra cosa' })
        .expect(409)
      expect(edit.body.code).toBe('EXPENSE_ALREADY_SETTLED')
      const remove = await api(adminToken)
        .delete(`/advance-expenses/${expense.id}`)
        .expect(409)
      expect(remove.body.code).toBe('EXPENSE_ALREADY_SETTLED')
    })

    it('eliminar es sólo admin, y es borrado lógico', async () => {
      const { id: contractId } = await createContract()
      const expense = await createExpense(contractId)

      await api(employeeToken)
        .delete(`/advance-expenses/${expense.id}`)
        .expect(403)
      await api(adminToken)
        .delete(`/advance-expenses/${expense.id}`)
        .expect(204)

      const gone = await api(adminToken)
        .patch(`/advance-expenses/${expense.id}`)
        .send({ description: 'x' })
        .expect(404)
      expect(gone.body.code).toBe('EXPENSE_NOT_FOUND')
      const list = await api(adminToken)
        .get(`/contracts/${contractId}/advance-expenses`)
        .expect(200)
      expect(list.body.data).toMatchObject({
        items: [],
        pendingTotal: '0.00',
        settledTotal: '0.00',
      })
      expect(
        await prisma.advanceExpense.findUnique({ where: { id: expense.id } }),
      ).toMatchObject({ deletedAt: expect.any(Date) })
    })
  })

  describe('aislamiento entre inmobiliarias', () => {
    it('otra inmobiliaria no ve ni opera los servicios, ni cruza propiedades o contratos', async () => {
      const { id: contractId, propertyId } = await createContract()
      const service = await createService(propertyId, {
        hasDueDate: true,
        dueDate: addDays(today, -2),
      })
      const b = api(adminBToken)

      await b.get(`/properties/${propertyId}/services`).expect(404)
      await b.get(`/contracts/${contractId}/services`).expect(404)
      await b.patch(`/services/${service.id}`).send({ notes: 'x' }).expect(404)
      await b.delete(`/services/${service.id}`).expect(404)

      const overdue = await b.get('/services/overdue').expect(200)
      expect(overdue.body.data.data).toEqual([])

      const crossProperty = await b
        .post(`/properties/${propertyId}/services`)
        .send(serviceBody({ serviceTypeId: refsB.luz }))
        .expect(422)
      expect(crossProperty.body.code).toBe('SERVICE_INVALID_PROPERTY')

      const propertyB = await createProperty(adminBToken, refsB)
      const crossContract = await b
        .post(`/properties/${propertyB}/services`)
        .send(serviceBody({ serviceTypeId: refsB.luz, contractId }))
        .expect(422)
      expect(crossContract.body.code).toBe('SERVICE_INVALID_CONTRACT')

      // Lo de A sigue intacto.
      const mine = await api(adminToken)
        .get(`/properties/${propertyId}/services`)
        .expect(200)
      expect(mine.body.data).toHaveLength(1)
    })

    it('otra inmobiliaria no ve ni opera los gastos adelantados, ni carga sobre un contrato ajeno', async () => {
      const { id: contractId } = await createContract()
      const expense = await createExpense(contractId)
      const b = api(adminBToken)

      await b.get(`/contracts/${contractId}/advance-expenses`).expect(404)
      await b
        .patch(`/advance-expenses/${expense.id}`)
        .send({ description: 'x' })
        .expect(404)
      await b.delete(`/advance-expenses/${expense.id}`).expect(404)

      const cross = await b
        .post(`/contracts/${contractId}/advance-expenses`)
        .field('amount', '100')
        .field('description', 'Ajeno')
        .field('expenseDate', today)
        .attach('file', PDF, { filename: 't.pdf' })
        .expect(422)
      expect(cross.body.code).toBe('EXPENSE_INVALID_CONTRACT')

      const mine = await api(adminToken)
        .get(`/contracts/${contractId}/advance-expenses`)
        .expect(200)
      expect(mine.body.data.items).toHaveLength(1)
    })
  })
})
