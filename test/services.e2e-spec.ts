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

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

const today = todayIso()

/** Servicios (spec Fase 10): criterios de aceptación, casos borde y aislamiento. */
describe('Servicios (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string }
  let tenantB: { id: string }
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
  })
})
