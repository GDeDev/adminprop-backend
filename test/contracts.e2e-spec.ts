import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import request from 'supertest'

import { seedBaseMasterData } from '../prisma/lib/master-data-seed'
import { ContractsFacade } from '../src/modules/contracts/public'
import { RequestContext } from '../src/shared/context/request-context'
import {
  addDays,
  addMonths,
  periodOf,
  todayIso,
} from '../src/shared/dates/calendar-date'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'

const PDF = Buffer.from('%PDF-1.4 prueba')
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

const today = todayIso()

/** Contratos (spec Fase 9): criterios de aceptación, casos borde y aislamiento. */
describe('Contratos (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string }
  let tenantB: { id: string }
  let admin: { id: string }
  let adminToken: string
  let employeeToken: string
  let adminBToken: string
  let refs: { tolosa: string; casa: string }
  let refsB: { tolosa: string; casa: string }

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
  const nextId = () => String(20_000_000 + ++counter)

  const createOwner = async (token = adminToken): Promise<string> => {
    const response = await api(token)
      .post('/owners')
      .send({ firstName: 'Juan', lastName: 'Pérez', nationalId: nextId() })
      .expect(201)
    return response.body.data.id
  }

  const createProperty = async (
    ownerId: string | null,
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

  const createGuarantor = async (token = adminToken): Promise<string> => {
    const response = await api(token)
      .post('/guarantors')
      .send({
        firstName: 'Marta',
        lastName: 'Gómez',
        nationalId: nextId(),
        guaranteeType: 'PROPERTY',
        guaranteeDetail: 'Calle 7 123, La Plata',
      })
      .expect(201)
    return response.body.data.id
  }

  const createRenter = async (
    guarantorId: string | null = null,
    token = adminToken,
  ): Promise<string> => {
    const response = await api(token)
      .post('/renters')
      .send({
        firstName: 'Iván',
        lastName: 'López',
        nationalId: nextId(),
        guarantorId,
      })
      .expect(201)
    return response.body.data.id
  }

  /** Una propiedad con dueño y un inquilino libres, listos para un contrato. */
  const parties = async () => {
    const ownerId = await createOwner()
    const propertyId = await createProperty(ownerId)
    const renterId = await createRenter()
    return { ownerId, propertyId, renterId }
  }

  const contractBody = (
    propertyId: string,
    renterId: string,
    overrides: Record<string, unknown> = {},
  ) => ({
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
    ...overrides,
  })

  const createContract = async (
    overrides: Record<string, unknown> = {},
    token = adminToken,
  ) => {
    const { propertyId, renterId, ownerId } = await parties()
    const response = await api(token)
      .post('/contracts')
      .send(contractBody(propertyId, renterId, overrides))
      .expect(201)
    return {
      id: response.body.data.id as string,
      propertyId,
      renterId,
      ownerId,
    }
  }

  const loadIndex = (indexType: string, period: string, value: string) =>
    api(adminToken)
      .post('/indices')
      .send({ indexType, period, value })
      .expect(201)

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

  describe('alta (spec 3.1)', () => {
    it('crea el contrato, alquila la propiedad, marca al inquilino y abre el historial del alquiler', async () => {
      const guarantorId = await createGuarantor()
      const ownerId = await createOwner()
      const propertyId = await createProperty(ownerId)
      const renterId = await createRenter(guarantorId)

      const response = await api(employeeToken)
        .post('/contracts')
        .send(
          contractBody(propertyId, renterId, { notes: '  Llave en portería ' }),
        )
        .expect(201)
      const contract = response.body.data

      expect(contract).toMatchObject({
        status: 'ACTIVE',
        property: { id: propertyId },
        owner: { id: ownerId, fullName: 'Juan Pérez' },
        renter: { id: renterId, fullName: 'Iván López' },
        guarantor: { id: guarantorId, fullName: 'Marta Gómez' },
        currentRent: '100000.00',
        initialRent: '100000.00',
        deposit: '100000.00',
        feePercentage: '5.00',
        currency: 'ARS',
        notes: 'Llave en portería',
        surety: null,
        termination: null,
        renewedFromId: null,
        expiringSoon: false,
        expired: false,
        suretyExpired: false,
        monthlyStatus: [],
      })
      expect(contract.rentUpdates).toHaveLength(1)
      expect(contract.rentUpdates[0]).toMatchObject({
        effectiveFrom: contractBody(propertyId, renterId).startDate,
        previousRent: null,
        newRent: '100000.00',
        source: 'INITIAL',
      })
      expect(contract.nextRentUpdateOn).toBe(
        addMonths(contractBody(propertyId, renterId).startDate, 3),
      )

      const property = await api(adminToken)
        .get(`/properties/${propertyId}`)
        .expect(200)
      expect(property.body.data).toMatchObject({
        status: 'RENTED',
        activeContractId: contract.id,
      })
      const renter = await api(adminToken)
        .get(`/renters/${renterId}`)
        .expect(200)
      expect(renter.body.data).toMatchObject({
        activeContractId: contract.id,
        activeContract: { id: contract.id },
      })

      // El alta corre en una transacción: la auditoría igual registra el
      // contrato con su autor.
      const log = await prisma.auditLog.findFirstOrThrow({
        where: { entity: 'Contract', entityId: contract.id, action: 'CREATE' },
      })
      const employee = await prisma.user.findFirstOrThrow({
        where: { email: 'emp@a.com' },
      })
      expect(log).toMatchObject({ tenantId: tenantA.id, userId: employee.id })
    })

    it('garantiza: sin indicar nada toma el del inquilino; null lo deja sin garante; uno dado tiene que existir', async () => {
      const guarantorId = await createGuarantor()
      const other = await createGuarantor()
      const ownerId = await createOwner()
      const renterId = await createRenter(guarantorId)

      const explicit = await api(adminToken)
        .post('/contracts')
        .send(
          contractBody(await createProperty(ownerId), renterId, {
            guarantorId: other,
          }),
        )
        .expect(201)
      expect(explicit.body.data.guarantor.id).toBe(other)

      await api(adminToken)
        .post(`/contracts/${explicit.body.data.id}/terminate`)
        .send({ notifiedAt: today })
        .expect(200)

      const none = await api(adminToken)
        .post('/contracts')
        .send(
          contractBody(await createProperty(ownerId), renterId, {
            guarantorId: null,
          }),
        )
        .expect(201)
      expect(none.body.data.guarantor).toBeNull()

      const unknown = await api(adminToken)
        .post('/contracts')
        .send(
          contractBody(await createProperty(ownerId), await createRenter(), {
            guarantorId: UNKNOWN_ID,
          }),
        )
        .expect(422)
      expect(unknown.body.code).toBe('CONTRACT_INVALID_GUARANTOR')
    })

    it('el tercer contrato activo del propietario nace con el honorario reducido (RN-07, D-57)', async () => {
      const ownerId = await createOwner()
      const fees: string[] = []
      for (let i = 0; i < 3; i++) {
        const response = await api(adminToken)
          .post('/contracts')
          .send(
            contractBody(await createProperty(ownerId), await createRenter()),
          )
          .expect(201)
        fees.push(response.body.data.feePercentage)
      }
      expect(fees).toEqual(['5.00', '5.00', '3.00'])

      // Los anteriores no se recalculan (spec 4).
      const list = await api(adminToken)
        .get(`/contracts?ownerId=${ownerId}`)
        .expect(200)
      expect(
        list.body.data.data
          .map((c: { feePercentage: string }) => c.feePercentage)
          .sort(),
      ).toEqual(['3.00', '5.00', '5.00'])
    })

    it('respeta el umbral y los porcentajes de cada inmobiliaria', async () => {
      await prisma.tenant.update({
        where: { id: tenantA.id },
        data: { reducedFeeThreshold: 1, reducedFeePercentage: '2.5' },
      })
      const { id } = await createContract()
      const response = await api(adminToken).get(`/contracts/${id}`).expect(200)
      expect(response.body.data.feePercentage).toBe('2.50')
    })

    it('propiedad con contrato activo → 409 (RN-04)', async () => {
      const { propertyId } = await createContract()
      const response = await api(adminToken)
        .post('/contracts')
        .send(contractBody(propertyId, await createRenter()))
        .expect(409)
      expect(response.body.code).toBe('CONTRACT_PROPERTY_ALREADY_RENTED')
    })

    it('inquilino con contrato activo → 409 (RN-05)', async () => {
      const { renterId } = await createContract()
      const response = await api(adminToken)
        .post('/contracts')
        .send(contractBody(await createProperty(await createOwner()), renterId))
        .expect(409)
      expect(response.body.code).toBe('CONTRACT_RENTER_ALREADY_ACTIVE')
    })

    it('una propiedad alquilada a mano, sin contrato, sí acepta el contrato', async () => {
      const propertyId = await createProperty(await createOwner())
      await api(adminToken)
        .patch(`/properties/${propertyId}/status`)
        .send({ status: 'RENTED' })
        .expect(200)
      await api(adminToken)
        .post('/contracts')
        .send(contractBody(propertyId, await createRenter()))
        .expect(201)
    })

    it('propiedad sin propietario → 422; propiedad o inquilino inexistentes → 422', async () => {
      const orphan = await createProperty(null)
      const noOwner = await api(adminToken)
        .post('/contracts')
        .send(contractBody(orphan, await createRenter()))
        .expect(422)
      expect(noOwner.body.code).toBe('CONTRACT_PROPERTY_WITHOUT_OWNER')

      const noProperty = await api(adminToken)
        .post('/contracts')
        .send(contractBody(UNKNOWN_ID, await createRenter()))
        .expect(422)
      expect(noProperty.body.code).toBe('CONTRACT_INVALID_PROPERTY')

      const noRenter = await api(adminToken)
        .post('/contracts')
        .send(
          contractBody(await createProperty(await createOwner()), UNKNOWN_ID),
        )
        .expect(422)
      expect(noRenter.body.code).toBe('CONTRACT_INVALID_RENTER')
    })

    it('caución sin email de la aseguradora → 400; con email, guarda el bloque', async () => {
      const { propertyId, renterId } = await parties()
      const missing = await api(adminToken)
        .post('/contracts')
        .send(contractBody(propertyId, renterId, { hasSurety: true }))
        .expect(400)
      expect(missing.body.code).toBe('CONTRACT_SURETY_EMAIL_REQUIRED')

      const ok = await api(adminToken)
        .post('/contracts')
        .send(
          contractBody(propertyId, renterId, {
            hasSurety: true,
            insurerName: 'Finaer',
            insurerAlertEmail: 'Alertas@Finaer.com',
            policyNumber: 'POL-1',
            policyExpiresAt: addDays(today, -1),
          }),
        )
        .expect(201)
      expect(ok.body.data).toMatchObject({
        hasSurety: true,
        suretyExpired: true,
        surety: {
          insurerName: 'Finaer',
          insurerAlertEmail: 'alertas@finaer.com',
          policyNumber: 'POL-1',
          policyExpiresAt: addDays(today, -1),
          policyPdfUrl: null,
          suretyExpired: true,
        },
      })
    })

    it('fin anterior o igual al inicio → 400; fecha inexistente → 400; monto como número → 400', async () => {
      const { propertyId, renterId } = await parties()
      const same = await api(adminToken)
        .post('/contracts')
        .send(
          contractBody(propertyId, renterId, {
            startDate: '2026-03-01',
            endDate: '2026-03-01',
          }),
        )
        .expect(400)
      expect(same.body.code).toBe('CONTRACT_DATES_INVALID')

      const fake = await api(adminToken)
        .post('/contracts')
        .send(contractBody(propertyId, renterId, { startDate: '2026-02-30' }))
        .expect(400)
      expect(fake.body.code).toBe('CONTRACT_INVALID_DATE')

      await api(adminToken)
        .post('/contracts')
        .send(contractBody(propertyId, renterId, { initialRent: 100000 }))
        .expect(400)
    })
  })

  describe('listado y ficha (spec 3.2, 3.3)', () => {
    it('filtra por estado, propiedad, inquilino y propietario', async () => {
      const first = await createContract()
      const second = await createContract()
      await api(adminToken)
        .post(`/contracts/${second.id}/terminate`)
        .send({ notifiedAt: today })
        .expect(200)

      const ids = (body: { data: { data: { id: string }[] } }) =>
        body.data.data.map((c) => c.id)

      const all = await api(adminToken).get('/contracts').expect(200)
      expect(all.body.data.pagination.total).toBe(2)
      expect(
        ids((await api(adminToken).get('/contracts?status=ACTIVE')).body),
      ).toEqual([first.id])
      expect(
        ids(
          (
            await api(adminToken).get(
              `/contracts?propertyId=${second.propertyId}`,
            )
          ).body,
        ),
      ).toEqual([second.id])
      expect(
        ids(
          (await api(adminToken).get(`/contracts?renterId=${first.renterId}`))
            .body,
        ),
      ).toEqual([first.id])
      expect(
        ids(
          (await api(adminToken).get(`/contracts?ownerId=${second.ownerId}`))
            .body,
        ),
      ).toEqual([second.id])
      await api(adminToken).get('/contracts?status=VIGENTE').expect(400)
    })

    it('expiringSoon usa los días de aviso de la inmobiliaria (RN-12)', async () => {
      const soon = await createContract({
        startDate: addMonths(today, -12),
        endDate: addDays(today, 30),
      })
      await createContract({
        startDate: addMonths(today, -12),
        endDate: addDays(today, 90),
      })

      const withDefault = await api(adminToken)
        .get('/contracts?expiringSoon=true')
        .expect(200)
      expect(
        withDefault.body.data.data.map((c: { id: string }) => c.id),
      ).toEqual([soon.id])
      expect(withDefault.body.data.data[0].expiringSoon).toBe(true)

      await prisma.tenant.update({
        where: { id: tenantA.id },
        data: { contractExpiryNoticeDays: 10 },
      })
      const withShortNotice = await api(adminToken)
        .get('/contracts?expiringSoon=true')
        .expect(200)
      expect(withShortNotice.body.data.data).toHaveLength(0)
      const detail = await api(adminToken)
        .get(`/contracts/${soon.id}`)
        .expect(200)
      expect(detail.body.data.expiringSoon).toBe(false)
    })

    it('un contrato activo con el fin pasado se marca vencido, no por vencer', async () => {
      const { id } = await createContract({
        startDate: addMonths(today, -13),
        endDate: addDays(today, -1),
      })
      const response = await api(adminToken).get(`/contracts/${id}`).expect(200)
      expect(response.body.data).toMatchObject({
        status: 'ACTIVE',
        expired: true,
        expiringSoon: false,
      })
    })

    it('la ficha trae la línea de tiempo calculada', async () => {
      const startDate = addMonths(today, -12)
      const { id } = await createContract({
        startDate,
        endDate: addDays(addMonths(startDate, 24), -1),
      })
      const response = await api(adminToken).get(`/contracts/${id}`).expect(200)
      const { timeline } = response.body.data
      expect(timeline).toMatchObject({ totalMonths: 24, elapsedMonths: 12 })
      expect(timeline.progressPercent).toBeGreaterThanOrEqual(49)
      expect(timeline.progressPercent).toBeLessThanOrEqual(51)
    })
  })

  describe('edición (D-55)', () => {
    it('cambia notas, caución y garante; lo demás no se acepta', async () => {
      const { id } = await createContract()
      const guarantorId = await createGuarantor()

      const response = await api(employeeToken)
        .patch(`/contracts/${id}`)
        .send({
          notes: 'Renovar la póliza en marzo',
          guarantorId,
          surety: {
            hasSurety: true,
            insurerName: 'Garantizar',
            insurerAlertEmail: 'alertas@garantizar.com',
          },
        })
        .expect(200)
      expect(response.body.data).toMatchObject({
        notes: 'Renovar la póliza en marzo',
        guarantor: { id: guarantorId },
        hasSurety: true,
        surety: { insurerName: 'Garantizar' },
      })

      // Sacar el email de un contrato con caución es un error.
      const noEmail = await api(adminToken)
        .patch(`/contracts/${id}`)
        .send({ surety: { insurerAlertEmail: null } })
        .expect(400)
      expect(noEmail.body.code).toBe('CONTRACT_SURETY_EMAIL_REQUIRED')

      await api(adminToken)
        .patch(`/contracts/${id}`)
        .send({ initialRent: '1' })
        .expect(400)
      await api(adminToken)
        .patch(`/contracts/${id}`)
        .send({ endDate: '2030-01-01' })
        .expect(400)
      await api(adminToken)
        .patch(`/contracts/${id}`)
        .send({ status: 'FINISHED' })
        .expect(400)

      const unknownGuarantor = await api(adminToken)
        .patch(`/contracts/${id}`)
        .send({ guarantorId: UNKNOWN_ID })
        .expect(422)
      expect(unknownGuarantor.body.code).toBe('CONTRACT_INVALID_GUARANTOR')
    })
  })

  describe('documentos (spec 3.4, 3.5)', () => {
    it('sube el PDF del contrato y el de la póliza; subir otro reemplaza al anterior', async () => {
      const { id } = await createContract({
        hasSurety: true,
        insurerAlertEmail: 'alertas@finaer.com',
      })

      const first = await api(employeeToken)
        .post(`/contracts/${id}/documents/contract`)
        .attach('file', PDF, {
          filename: 'c.pdf',
          contentType: 'application/pdf',
        })
        .expect(201)
      const firstUrl: string = first.body.data.contractPdfUrl
      expect(firstUrl).toMatch(/\.pdf$/)

      const second = await api(employeeToken)
        .post(`/contracts/${id}/documents/contract`)
        .attach('file', PDF, {
          filename: 'c2.pdf',
          contentType: 'application/pdf',
        })
        .expect(201)
      expect(second.body.data.contractPdfUrl).not.toBe(firstUrl)

      const policy = await api(employeeToken)
        .post(`/contracts/${id}/documents/policy`)
        .attach('file', PDF, {
          filename: 'p.pdf',
          contentType: 'application/pdf',
        })
        .expect(201)
      expect(policy.body.data.surety.policyPdfUrl).toMatch(/\.pdf$/)
    })

    it('algo que no es un PDF, o ningún archivo → 400', async () => {
      const { id } = await createContract()
      const notPdf = await api(adminToken)
        .post(`/contracts/${id}/documents/contract`)
        .attach('file', Buffer.from('#!/bin/sh'), {
          filename: 'c.pdf',
          contentType: 'application/pdf',
        })
        .expect(400)
      expect(notPdf.body.code).toBe('CONTRACT_INVALID_DOCUMENT')

      const empty = await api(adminToken)
        .post(`/contracts/${id}/documents/policy`)
        .expect(400)
      expect(empty.body.code).toBe('CONTRACT_INVALID_DOCUMENT')
    })
  })

  describe('actualización del alquiler (spec 3.8, RN-15)', () => {
    it('FIXED: aplica el aumento vencido con el monto a mano, y el siguiente todavía no corresponde', async () => {
      const startDate = addMonths(today, -3)
      const { id } = await createContract({ startDate })

      const missing = await api(adminToken)
        .post(`/contracts/${id}/rent-updates`)
        .send({})
        .expect(400)
      expect(missing.body.code).toBe('CONTRACT_NEW_RENT_REQUIRED')

      const applied = await api(employeeToken)
        .post(`/contracts/${id}/rent-updates`)
        .send({ newRent: '120000' })
        .expect(201)
      expect(applied.body.data.currentRent).toBe('120000.00')
      expect(applied.body.data.rentUpdates).toHaveLength(2)
      expect(applied.body.data.rentUpdates[0]).toMatchObject({
        effectiveFrom: addMonths(startDate, 3),
        previousRent: '100000.00',
        newRent: '120000.00',
        source: 'MANUAL',
        indexType: null,
      })

      const notDue = await api(adminToken)
        .post(`/contracts/${id}/rent-updates`)
        .send({ newRent: '130000' })
        .expect(409)
      expect(notDue.body.code).toBe('CONTRACT_RENT_UPDATE_NOT_DUE')
    })

    it('ICL: usa los índices de los dos períodos; si falta uno, 422 con el período', async () => {
      const startDate = addMonths(today, -2)
      const { id } = await createContract({
        startDate,
        rentUpdateType: 'ICL',
        rentUpdateFrequency: 'MONTHLY',
      })
      const fromPeriod = periodOf(startDate)
      const toPeriod = periodOf(addMonths(startDate, 1))

      const noIndex = await api(adminToken)
        .post(`/contracts/${id}/rent-updates`)
        .send({})
        .expect(422)
      expect(noIndex.body.code).toBe('CONTRACT_INDEX_MISSING')
      expect(noIndex.body.message).toContain(`ICL de ${fromPeriod}`)

      await loadIndex('ICL', fromPeriod, '1500')
      await loadIndex('ICL', toPeriod, '1650')
      const applied = await api(adminToken)
        .post(`/contracts/${id}/rent-updates`)
        .send({})
        .expect(201)
      expect(applied.body.data.currentRent).toBe('110000.00')
      expect(applied.body.data.rentUpdates[0]).toMatchObject({
        effectiveFrom: addMonths(startDate, 1),
        previousRent: '100000.00',
        newRent: '110000.00',
        source: 'INDEX',
        indexType: 'ICL',
        indexFromPeriod: fromPeriod,
        indexToPeriod: toPeriod,
        indexFromValue: '1500.000000',
        indexToValue: '1650.000000',
        appliedById: admin.id,
      })

      // El segundo aumento también está vencido, pero falta su índice.
      const nextMissing = await api(adminToken)
        .post(`/contracts/${id}/rent-updates`)
        .send({})
        .expect(422)
      expect(nextMissing.body.message).toContain(
        `ICL de ${periodOf(addMonths(startDate, 2))}`,
      )
    })

    it('sobre un contrato que no está activo → 409', async () => {
      const { id } = await createContract({ startDate: addMonths(today, -3) })
      await api(adminToken)
        .post(`/contracts/${id}/terminate`)
        .send({ notifiedAt: today })
        .expect(200)
      const response = await api(adminToken)
        .post(`/contracts/${id}/rent-updates`)
        .send({ newRent: '120000' })
        .expect(409)
      expect(response.body.code).toBe('CONTRACT_NOT_ACTIVE')
    })
  })

  describe('rescisión anticipada (spec 3.6, RN-09)', () => {
    it('la vista previa y la rescisión calculan lo mismo; la propiedad vuelve a disponible', async () => {
      const { id, propertyId, renterId } = await createContract({
        startDate: '2026-01-01',
        endDate: '2027-12-31',
      })

      const preview = await api(employeeToken)
        .get(`/contracts/${id}/termination-preview?notifiedAt=2026-12-01`)
        .expect(200)
      expect(preview.body.data).toEqual({
        currentRent: '100000.00',
        remainingMonths: 12,
        remainingDays: 30,
        totalDays: 395,
        futureRent: '1300000.00',
        penalty: '130000.00',
      })
      const stillActive = await api(adminToken)
        .get(`/contracts/${id}`)
        .expect(200)
      expect(stillActive.body.data.status).toBe('ACTIVE')

      const terminated = await api(employeeToken)
        .post(`/contracts/${id}/terminate`)
        .send({ notifiedAt: '2026-12-01' })
        .expect(200)
      expect(terminated.body.data).toMatchObject({
        penalty: '130000.00',
        futureRent: '1300000.00',
        remainingMonths: 12,
        remainingDays: 30,
        notifiedAt: '2026-12-01',
        contract: {
          id,
          status: 'TERMINATED',
          termination: {
            terminatedAt: '2026-12-01',
            notifiedAt: '2026-12-01',
            penalty: '130000.00',
            futureRent: '1300000.00',
          },
        },
      })

      const property = await api(adminToken)
        .get(`/properties/${propertyId}`)
        .expect(200)
      expect(property.body.data).toMatchObject({
        status: 'AVAILABLE',
        activeContractId: null,
      })
      const renter = await api(adminToken)
        .get(`/renters/${renterId}`)
        .expect(200)
      expect(renter.body.data.activeContractId).toBeNull()

      const again = await api(adminToken)
        .post(`/contracts/${id}/terminate`)
        .send({ notifiedAt: '2026-12-01' })
        .expect(409)
      expect(again.body.code).toBe('CONTRACT_NOT_ACTIVE')
    })

    it('notificación antes del inicio o desde el día de fin → 400 (spec 7)', async () => {
      const { id } = await createContract({
        startDate: '2026-01-01',
        endDate: '2027-12-31',
      })
      for (const notifiedAt of ['2025-12-31', '2027-12-31', '2028-01-15']) {
        const response = await api(adminToken)
          .post(`/contracts/${id}/terminate`)
          .send({ notifiedAt })
          .expect(400)
        expect(response.body.code).toBe('CONTRACT_TERMINATION_DATE_INVALID')
      }
      await api(adminToken)
        .get(`/contracts/${id}/termination-preview?notifiedAt=2028-01-15`)
        .expect(400)
    })
  })

  describe('renovación (spec 3.7)', () => {
    it('crea el nuevo activo con lo del original, finaliza el original y mueve los vínculos', async () => {
      const original = await createContract({
        startDate: addMonths(today, -23),
        endDate: addDays(today, 10),
        rentUpdateType: 'ICL',
        hasSurety: true,
        insurerName: 'Finaer',
        insurerAlertEmail: 'alertas@finaer.com',
      })
      const startDate = addDays(today, 11)
      const response = await api(employeeToken)
        .post(`/contracts/${original.id}/renew`)
        .send({
          startDate,
          endDate: addDays(addMonths(startDate, 24), -1),
          initialRent: '150000',
        })
        .expect(201)
      const renewed = response.body.data
      expect(renewed).toMatchObject({
        status: 'ACTIVE',
        renewedFromId: original.id,
        property: { id: original.propertyId },
        renter: { id: original.renterId },
        currentRent: '150000.00',
        rentUpdateType: 'ICL',
        rentUpdateFrequency: 'QUARTERLY',
        deposit: '100000.00',
        hasSurety: true,
        surety: { insurerName: 'Finaer' },
        feePercentage: '5.00',
      })
      expect(renewed.id).not.toBe(original.id)

      const old = await api(adminToken)
        .get(`/contracts/${original.id}`)
        .expect(200)
      expect(old.body.data.status).toBe('FINISHED')

      const property = await api(adminToken)
        .get(`/properties/${original.propertyId}`)
        .expect(200)
      expect(property.body.data).toMatchObject({
        status: 'RENTED',
        activeContractId: renewed.id,
      })
      const renter = await api(adminToken)
        .get(`/renters/${original.renterId}`)
        .expect(200)
      expect(renter.body.data.activeContractId).toBe(renewed.id)

      const again = await api(adminToken)
        .post(`/contracts/${original.id}/renew`)
        .send({ startDate, endDate: addMonths(startDate, 12) })
        .expect(409)
      expect(again.body.code).toBe('CONTRACT_NOT_ACTIVE')
    })

    it('con otro inquilino (spec 7): el anterior queda libre y el nuevo vinculado', async () => {
      const original = await createContract()
      const newRenter = await createRenter()
      const response = await api(adminToken)
        .post(`/contracts/${original.id}/renew`)
        .send({
          renterId: newRenter,
          startDate: today,
          endDate: addMonths(today, 12),
        })
        .expect(201)
      expect(response.body.data.renter.id).toBe(newRenter)
      expect(response.body.data.guarantor).toBeNull()

      const previous = await api(adminToken)
        .get(`/renters/${original.renterId}`)
        .expect(200)
      expect(previous.body.data.activeContractId).toBeNull()
      const current = await api(adminToken)
        .get(`/renters/${newRenter}`)
        .expect(200)
      expect(current.body.data.activeContractId).toBe(response.body.data.id)
    })

    it('inicio anterior al original → 400; inquilino con otro contrato activo → 409', async () => {
      const original = await createContract({ startDate: '2026-01-01' })
      const before = await api(adminToken)
        .post(`/contracts/${original.id}/renew`)
        .send({ startDate: '2025-12-01', endDate: '2027-12-01' })
        .expect(400)
      expect(before.body.code).toBe('CONTRACT_RENEWAL_START_INVALID')

      const other = await createContract()
      const busy = await api(adminToken)
        .post(`/contracts/${original.id}/renew`)
        .send({
          renterId: other.renterId,
          startDate: today,
          endDate: addMonths(today, 12),
        })
        .expect(409)
      expect(busy.body.code).toBe('CONTRACT_RENTER_ALREADY_ACTIVE')
    })
  })

  describe('facade para el cron (Fase 13)', () => {
    it('finishExpired cierra los vencidos y libera propiedad e inquilino; listDueForRentUpdate lista los atrasados', async () => {
      const expired = await createContract({
        startDate: addMonths(today, -13),
        endDate: addDays(today, -1),
      })
      const due = await createContract({ startDate: addMonths(today, -3) })
      const notDue = await createContract({ startDate: today })

      const facade = app.get(ContractsFacade)
      expect(await inTenantA(() => facade.listDueForRentUpdate())).toEqual(
        expect.arrayContaining([expired.id, due.id]),
      )
      expect(
        await inTenantA(() => facade.listDueForRentUpdate()),
      ).not.toContain(notDue.id)

      expect(await inTenantA(() => facade.finishExpired())).toBe(1)
      expect(await inTenantA(() => facade.finishExpired())).toBe(0)

      const closed = await api(adminToken)
        .get(`/contracts/${expired.id}`)
        .expect(200)
      expect(closed.body.data.status).toBe('FINISHED')
      const property = await api(adminToken)
        .get(`/properties/${expired.propertyId}`)
        .expect(200)
      expect(property.body.data).toMatchObject({
        status: 'AVAILABLE',
        activeContractId: null,
      })
      expect(
        await inTenantA(() => facade.getActiveByProperty(due.propertyId)),
      ).toMatchObject({ id: due.id, currentRent: '100000.00' })
      expect(
        await inTenantA(() => facade.getActiveByProperty(expired.propertyId)),
      ).toBeNull()
    })
  })

  describe('efectos sobre propiedades e inquilinos', () => {
    it('con contrato activo la propiedad no vuelve a disponible a mano (409), pero sí a mantenimiento', async () => {
      const { propertyId } = await createContract()
      const blocked = await api(adminToken)
        .patch(`/properties/${propertyId}/status`)
        .send({ status: 'AVAILABLE' })
        .expect(409)
      expect(blocked.body.code).toBe('PROPERTY_HAS_ACTIVE_CONTRACT')
      await api(adminToken)
        .patch(`/properties/${propertyId}/status`)
        .send({ status: 'MAINTENANCE' })
        .expect(200)
    })

    it('una propiedad con historial de contratos no se borra, ni después de rescindir', async () => {
      const { id, propertyId } = await createContract()
      const active = await api(adminToken)
        .delete(`/properties/${propertyId}`)
        .expect(409)
      expect(active.body.code).toBe('PROPERTY_HAS_CONTRACT_HISTORY')

      await api(adminToken)
        .post(`/contracts/${id}/terminate`)
        .send({ notifiedAt: today })
        .expect(200)
      await api(adminToken).delete(`/properties/${propertyId}`).expect(409)
    })

    it('un inquilino con contrato activo no se borra; rescindido el contrato, sí', async () => {
      const { id, renterId } = await createContract()
      const blocked = await api(adminToken)
        .delete(`/renters/${renterId}`)
        .expect(409)
      expect(blocked.body.code).toBe('RENTER_HAS_ACTIVE_CONTRACT')

      await api(adminToken)
        .post(`/contracts/${id}/terminate`)
        .send({ notifiedAt: today })
        .expect(200)
      await api(adminToken).delete(`/renters/${renterId}`).expect(204)
    })

    it('el garante de un inquilino con contrato no se borra (lo frena el inquilino)', async () => {
      const guarantorId = await createGuarantor()
      const ownerId = await createOwner()
      const renterId = await createRenter(guarantorId)
      await api(adminToken)
        .post('/contracts')
        .send(contractBody(await createProperty(ownerId), renterId))
        .expect(201)
      const response = await api(adminToken)
        .delete(`/guarantors/${guarantorId}`)
        .expect(409)
      expect(response.body.code).toBe('GUARANTOR_IN_USE')
    })
  })

  describe('aislamiento entre inmobiliarias', () => {
    it('otra inmobiliaria no ve ni opera el contrato', async () => {
      const { id } = await createContract()
      const b = api(adminBToken)

      await b.get(`/contracts/${id}`).expect(404)
      await b.patch(`/contracts/${id}`).send({ notes: 'x' }).expect(404)
      await b
        .post(`/contracts/${id}/terminate`)
        .send({ notifiedAt: today })
        .expect(404)
      await b
        .get(`/contracts/${id}/termination-preview?notifiedAt=${today}`)
        .expect(404)
      await b
        .post(`/contracts/${id}/renew`)
        .send({ startDate: today, endDate: addMonths(today, 12) })
        .expect(404)
      await b
        .post(`/contracts/${id}/rent-updates`)
        .send({ newRent: '1' })
        .expect(404)
      await b
        .post(`/contracts/${id}/documents/contract`)
        .attach('file', PDF, {
          filename: 'c.pdf',
          contentType: 'application/pdf',
        })
        .expect(404)

      const list = await b.get('/contracts').expect(200)
      expect(list.body.data.data).toHaveLength(0)
    })

    it('no se puede armar un contrato con una propiedad o un inquilino de otra inmobiliaria', async () => {
      const { propertyId, renterId } = await parties()
      const ownerB = await createOwner(adminBToken)
      const propertyB = await createProperty(ownerB, adminBToken, refsB)
      const renterB = await createRenter(null, adminBToken)

      const foreignProperty = await api(adminBToken)
        .post('/contracts')
        .send(contractBody(propertyId, renterB))
        .expect(422)
      expect(foreignProperty.body.code).toBe('CONTRACT_INVALID_PROPERTY')

      const foreignRenter = await api(adminBToken)
        .post('/contracts')
        .send(contractBody(propertyB, renterId))
        .expect(422)
      expect(foreignRenter.body.code).toBe('CONTRACT_INVALID_RENTER')

      // Mismo inquilino "ocupado" en A: en B es otro id, no hay cruce.
      await api(adminBToken)
        .post('/contracts')
        .send(contractBody(propertyB, renterB))
        .expect(201)
    })
  })

  it('un empleado crea contratos, pero cargar índices es sólo de admin', async () => {
    await createContract({}, employeeToken)
    await api(employeeToken)
      .post('/indices')
      .send({ indexType: 'ICL', period: '2026-01', value: '1' })
      .expect(403)
  })
})
