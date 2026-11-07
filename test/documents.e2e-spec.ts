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
const previous = periodOf(addMonths(today, -1))

/** PDFs (Fase 15): eventos -> documento real renderizado, subido y enlazado; regeneración; autorización. */
describe('Documentos PDF (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string }
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
  const nextId = () => String(60_000_000 + ++counter)

  const createContract = async () => {
    const owner = await api(adminToken)
      .post('/owners')
      .send({
        firstName: 'Ana',
        lastName: 'Gómez',
        nationalId: nextId(),
        bankAccount: { cbu: '0110599552000000123456' },
      })
      .expect(201)
    const property = await api(adminToken)
      .post('/properties')
      .send({
        address: `Calle ${++counter}`,
        locationId: master.tolosa,
        propertyTypeId: master.casa,
        ownerId: owner.body.data.id,
      })
      .expect(201)
    const renter = await api(adminToken)
      .post('/renters')
      .send({ firstName: 'Iván', lastName: 'López', nationalId: nextId() })
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
        lateFeeGraceDays: 90,
      })
      .expect(201)
    return {
      id: contract.body.data.id as string,
      ownerId: owner.body.data.id as string,
      renterId: renter.body.data.id as string,
    }
  }

  /** Paga entera la cuota del mes pasado: dispara recibo y liquidación pendiente. */
  const payInstallment = async (contractId: string) => {
    await api(adminToken)
      .post('/billing/installments/generate')
      .send({ period: previous })
      .expect(200)
    const installments = await api(adminToken)
      .get(`/billing/installments?contractId=${contractId}&period=${previous}`)
      .expect(200)
    const installment = installments.body.data.data[0]
    const req = api(adminToken).post(
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

  /** Espera a que el documento esté `READY` (202 mientras se genera). */
  const readyDocument = async (
    kind: string,
    entityId: string,
    minVersion = 1,
    token = adminToken,
  ) => {
    let body: { data: Record<string, unknown> } | undefined
    await waitFor(async () => {
      const response = await api(token).get(`/documents/${kind}/${entityId}`)
      if (response.status === 200 && response.body.data.status === 'READY') {
        const version = response.body.data.version as number
        if (version >= minVersion) {
          body = response.body
          return true
        }
      }
      return false
    })
    return body!.data as {
      id: string
      status: string
      version: number
      url: string
      sizeBytes: number
    }
  }

  const download = async (url: string): Promise<Buffer> => {
    const response = await request(app.getHttpServer())
      .get(new URL(url).pathname)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => callback(null, Buffer.concat(chunks)))
      })
      .expect(200)
    return response.body as Buffer
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
    const tenantB = await createTenant(prisma, 'tenant-b')
    await seedBaseMasterData(prisma, tenantA.id, { withSampleCities: true })
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
  })

  it('un pago confirmado genera su recibo numerado; el segundo suma 1; anularlo crea una versión nueva', async () => {
    const first = await createContract()
    const { paymentId } = await payInstallment(first.id)

    const receipt = await readyDocument('PAYMENT_RECEIPT', paymentId)
    expect(receipt.version).toBe(1)
    expect(receipt.sizeBytes).toBeGreaterThan(1024)
    const pdf = await download(receipt.url)
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')

    const payments = await api(adminToken)
      .get(`/billing/payments?contractId=${first.id}`)
      .expect(200)
    expect(payments.body.data.data[0]).toMatchObject({
      id: paymentId,
      receiptNumber: 'R-00000001',
      receiptPdfUrl: receipt.url,
    })

    const second = await createContract()
    const another = await payInstallment(second.id)
    await readyDocument('PAYMENT_RECEIPT', another.paymentId)
    const secondPayments = await api(adminToken)
      .get(`/billing/payments?contractId=${second.id}`)
      .expect(200)
    expect(secondPayments.body.data.data[0].receiptNumber).toBe('R-00000002')

    await api(adminToken)
      .post(`/billing/payments/${paymentId}/void`)
      .send({ reason: 'Error de carga' })
      .expect(200)
    const voided = await readyDocument('PAYMENT_RECEIPT', paymentId, 2)
    expect(voided.url).not.toBe(receipt.url)
    expect((await download(voided.url)).subarray(0, 4).toString()).toBe('%PDF')
    // El número no cambia al anular.
    const after = await api(adminToken)
      .get(`/billing/payments?contractId=${first.id}`)
      .expect(200)
    expect(after.body.data.data[0].receiptNumber).toBe('R-00000001')
  })

  it('confirmar una liquidación y cerrar un consolidado generan sus PDFs', async () => {
    const contract = await createContract()
    await payInstallment(contract.id)
    let settlementId = ''
    await waitFor(async () => {
      const list = await api(adminToken)
        .get(`/settlements?contractId=${contract.id}`)
        .expect(200)
      settlementId = list.body.data.data[0]?.id ?? ''
      return settlementId !== ''
    })
    await api(adminToken)
      .post(`/settlements/${settlementId}/confirm`)
      .expect(200)

    const settlement = await readyDocument('SETTLEMENT', settlementId)
    expect((await download(settlement.url)).subarray(0, 4).toString()).toBe(
      '%PDF',
    )
    const detail = await api(adminToken)
      .get(`/settlements/${settlementId}`)
      .expect(200)
    expect(detail.body.data.pdfUrl).toBe(settlement.url)

    const statement = await api(adminToken)
      .post('/statements')
      .send({ ownerId: contract.ownerId, period: periodOf(today) })
      .expect(201)
    await api(adminToken)
      .post(`/statements/${statement.body.data.id}/settlements`)
      .send({ settlementIds: [settlementId] })
      .expect(200)
    await api(adminToken)
      .post(`/statements/${statement.body.data.id}/close`)
      .send({ sendMode: 'SUMMARY' })
      .expect(200)
    const summary = await readyDocument(
      'OWNER_STATEMENT',
      statement.body.data.id,
    )
    expect((await download(summary.url)).subarray(0, 4).toString()).toBe('%PDF')
    const closed = await api(adminToken)
      .get(`/statements/${statement.body.data.id}`)
      .expect(200)
    expect(closed.body.data.pdfUrl).toBe(summary.url)
  })

  it('rescindir un contrato genera el cálculo y lo deja en la ficha', async () => {
    const contract = await createContract()
    await api(adminToken)
      .post(`/contracts/${contract.id}/terminate`)
      .send({ notifiedAt: today })
      .expect(200)
    const notice = await readyDocument('TERMINATION_NOTICE', contract.id)
    expect((await download(notice.url)).subarray(0, 4).toString()).toBe('%PDF')
    const detail = await api(adminToken)
      .get(`/contracts/${contract.id}`)
      .expect(200)
    expect(detail.body.data.terminationPdfUrl).toBe(notice.url)
  })

  it('regenerar (admin) encola una versión nueva sin pisar la anterior; el listado la muestra', async () => {
    const contract = await createContract()
    await api(adminToken)
      .post(`/contracts/${contract.id}/terminate`)
      .send({ notifiedAt: today })
      .expect(200)
    const first = await readyDocument('TERMINATION_NOTICE', contract.id)

    await api(employeeToken)
      .post(`/documents/TERMINATION_NOTICE/${contract.id}/regenerate`)
      .expect(403)
    const regenerate = await api(adminToken)
      .post(`/documents/TERMINATION_NOTICE/${contract.id}/regenerate`)
      .expect(202)
    expect(regenerate.body.data).toMatchObject({
      version: 2,
      status: 'PENDING',
      requestedBy: { fullName: expect.any(String) },
    })
    const second = await readyDocument('TERMINATION_NOTICE', contract.id, 2)
    expect(second.url).not.toBe(first.url)
    expect((await download(first.url)).subarray(0, 4).toString()).toBe('%PDF')

    const list = await api(adminToken)
      .get(`/documents?kind=TERMINATION_NOTICE&entityId=${contract.id}`)
      .expect(200)
    expect(
      list.body.data.data.map((d: { version: number }) => d.version),
    ).toEqual([2, 1])
    await api(employeeToken).get('/documents').expect(403)
  })

  it('valida el tipo, responde 404 si nunca se pidió y aísla por inmobiliaria', async () => {
    const contract = await createContract()
    await api(adminToken).get(`/documents/NOPE/${contract.id}`).expect(400)
    const missing = await api(adminToken)
      .get(`/documents/SETTLEMENT/${UNKNOWN_ID}`)
      .expect(404)
    expect(missing.body.code).toBe('DOCUMENT_NOT_FOUND')
    await api(adminToken)
      .post(`/documents/PAYMENT_RECEIPT/${UNKNOWN_ID}/regenerate`)
      .expect(404)

    await api(adminToken)
      .post(`/contracts/${contract.id}/terminate`)
      .send({ notifiedAt: today })
      .expect(200)
    await readyDocument('TERMINATION_NOTICE', contract.id)
    await api(adminBToken)
      .get(`/documents/TERMINATION_NOTICE/${contract.id}`)
      .expect(404)
    await api(adminBToken)
      .post(`/documents/TERMINATION_NOTICE/${contract.id}/regenerate`)
      .expect(404)
  })

  it('un propietario o inquilino de portal sólo baja lo suyo', async () => {
    const mine = await createContract()
    const other = await createContract()
    const { paymentId } = await payInstallment(mine.id)
    await readyDocument('PAYMENT_RECEIPT', paymentId)
    for (const contract of [mine, other]) {
      await api(adminToken)
        .post(`/contracts/${contract.id}/terminate`)
        .send({ notifiedAt: today })
        .expect(200)
      await readyDocument('TERMINATION_NOTICE', contract.id)
    }

    const ownerUser = await createUser(prisma, {
      tenantId: tenantA.id,
      email: 'owner@a.com',
      role: Role.OWNER,
    })
    await prisma.owner.update({
      where: { id: mine.ownerId },
      data: { portalUserId: ownerUser.id },
    })
    const renterUser = await createUser(prisma, {
      tenantId: tenantA.id,
      email: 'renter@a.com',
      role: Role.RENTER,
    })
    await prisma.renter.update({
      where: { id: mine.renterId },
      data: { portalUserId: renterUser.id },
    })
    const ownerToken = await loginToPortalAs(app, 'tenant-a', 'owner@a.com')
    const renterToken = await loginToPortalAs(
      app,
      'tenant-a',
      'renter@a.com',
      'RENTER',
    )

    const own = await api(ownerToken)
      .get(`/documents/TERMINATION_NOTICE/${mine.id}`)
      .expect(200)
    expect(own.body.data.error).toBeNull()
    await api(ownerToken)
      .get(`/documents/TERMINATION_NOTICE/${other.id}`)
      .expect(404)
    await api(renterToken)
      .get(`/documents/TERMINATION_NOTICE/${mine.id}`)
      .expect(200)
    await api(renterToken)
      .get(`/documents/TERMINATION_NOTICE/${other.id}`)
      .expect(404)
    await api(renterToken)
      .get(`/documents/PAYMENT_RECEIPT/${paymentId}`)
      .expect(200)
    // Un inquilino no ve liquidaciones ni un propietario recibos.
    await api(renterToken)
      .get(`/documents/SETTLEMENT/${UNKNOWN_ID}`)
      .expect(404)
    await api(ownerToken)
      .get(`/documents/PAYMENT_RECEIPT/${paymentId}`)
      .expect(404)
    // Y ninguno regenera ni lista.
    await api(ownerToken).get('/documents').expect(403)
    await api(renterToken)
      .post(`/documents/TERMINATION_NOTICE/${mine.id}/regenerate`)
      .expect(403)
  })
})
