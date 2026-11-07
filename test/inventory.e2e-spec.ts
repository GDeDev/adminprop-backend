import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import request from 'supertest'

import { seedBaseMasterData } from '../prisma/lib/master-data-seed'
import { addDays, addMonths, todayIso } from '../src/shared/dates/calendar-date'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginAs, loginToPortalAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
const PDF = Buffer.from('%PDF-1.4 no es una foto')
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

const today = todayIso()

/** Inventario del inmueble (Fase 25): flujo, reglas, comparación, permisos y aislamiento. */
describe('Inventario del inmueble (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string }
  let tenantB: { id: string }
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
  const nextId = () => String(40_000_000 + ++counter)

  /** Una propiedad con su contrato activo. */
  const createContract = async (token = adminToken, master = refs) => {
    const owner = await api(token)
      .post('/owners')
      .send({ firstName: 'Juan', lastName: 'Pérez', nationalId: nextId() })
      .expect(201)
    const property = await api(token)
      .post('/properties')
      .send({
        address: `Calle ${++counter}`,
        locationId: master.tolosa,
        propertyTypeId: master.casa,
        ownerId: owner.body.data.id,
      })
      .expect(201)
    const renter = await api(token)
      .post('/renters')
      .send({ firstName: 'Iván', lastName: 'López', nationalId: nextId() })
      .expect(201)
    const response = await api(token)
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
      })
      .expect(201)
    return response.body.data.id as string
  }

  const createInventory = async (
    contractId: string,
    body: Record<string, unknown> = { type: 'DELIVERY' },
    token = adminToken,
  ) => {
    const response = await api(token)
      .post(`/contracts/${contractId}/inventories`)
      .send(body)
      .expect(201)
    return response.body.data
  }

  /** Evalúa los dos primeros ítems de la plantilla y deja el resto en "No aplica". */
  const evaluate = async (
    inventory: { id: string; items: Record<string, any>[] },
    conditions: string[] = ['GOOD', 'POOR'],
    token = adminToken,
  ) => {
    const items = inventory.items.map((item, index) => ({
      id: item.id,
      category: item.category,
      description: item.description,
      condition: conditions[index] ?? item.condition,
      notes: item.notes,
    }))
    const response = await api(token)
      .patch(`/inventories/${inventory.id}`)
      .send({ items })
      .expect(200)
    return response.body.data
  }

  const uploadPhotos = (
    inventoryId: string,
    itemId: string,
    files: Buffer[],
    token = adminToken,
  ) => {
    const req = api(token).post(
      `/inventories/${inventoryId}/items/${itemId}/photos`,
    )
    for (const file of files) {
      req.attach('files', file, { filename: 'foto.jpg' })
    }
    return req
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

  describe('alta y borrador', () => {
    it('crea la entrega con la plantilla estándar en "No aplica" y la lista', async () => {
      const contractId = await createContract()

      const before = await api(adminToken)
        .get(`/contracts/${contractId}/inventories`)
        .expect(200)
      expect(before.body.data).toEqual({
        inventories: [],
        canCreateDelivery: true,
        canCreateReturn: false,
      })

      const created = await createInventory(
        contractId,
        { type: 'DELIVERY', generalNotes: '  Se entregó con llaves ' },
        employeeToken,
      )
      expect(created).toMatchObject({
        contractId,
        type: 'DELIVERY',
        date: today,
        status: 'DRAFT',
        tenantAcknowledged: false,
        generalNotes: 'Se entregó con llaves',
        poorCount: 0,
        photoCount: 0,
        confirmedAt: null,
        correctsInventoryId: null,
        correctionReason: null,
        warnings: [],
      })
      expect(created.performedBy).toMatchObject({ fullName: 'emp@a.com' })
      expect(created.itemCount).toBe(created.items.length)
      expect(created.items.length).toBeGreaterThanOrEqual(18)
      expect(
        created.items.every(
          (i: any) => i.condition === 'NOT_APPLICABLE' && i.photos.length === 0,
        ),
      ).toBe(true)
      expect(created.items.map((i: any) => i.category)).toEqual(
        expect.arrayContaining(['Cocina', 'Baños', 'Pisos', 'Aberturas']),
      )

      const after = await api(adminToken)
        .get(`/contracts/${contractId}/inventories`)
        .expect(200)
      expect(after.body.data.canCreateDelivery).toBe(false)
      expect(after.body.data.inventories).toHaveLength(1)
      expect(after.body.data.inventories[0]).not.toHaveProperty('items')
    })

    it('acepta ítems propios y una fecha, y no permite dos entregas vigentes', async () => {
      const contractId = await createContract()
      const created = await createInventory(contractId, {
        type: 'DELIVERY',
        date: addDays(today, -1),
        items: [
          {
            category: 'Cocina',
            description: 'Mesada',
            condition: 'GOOD',
            notes: null,
          },
        ],
      })
      expect(created.date).toBe(addDays(today, -1))
      expect(created.items).toHaveLength(1)

      const again = await api(adminToken)
        .post(`/contracts/${contractId}/inventories`)
        .send({ type: 'DELIVERY' })
        .expect(409)
      expect(again.body.code).toBe('INVENTORY_ALREADY_EXISTS')
    })

    it('valida el cuerpo del alta y que el contrato exista', async () => {
      const contractId = await createContract()
      await api(adminToken)
        .post(`/contracts/${contractId}/inventories`)
        .send({ type: 'OTRO' })
        .expect(400)
      await api(adminToken)
        .post(`/contracts/${contractId}/inventories`)
        .send({ type: 'DELIVERY', date: '2026-02-30' })
        .expect(400)
      const missing = await api(adminToken)
        .post(`/contracts/${UNKNOWN_ID}/inventories`)
        .send({ type: 'DELIVERY' })
        .expect(404)
      expect(missing.body.code).toBe('INVENTORY_CONTRACT_NOT_FOUND')
    })

    it('edita fecha, notas y conformidad, y reemplaza la lista de ítems', async () => {
      const contractId = await createContract()
      const created = await createInventory(contractId)
      const [first, second] = created.items

      const updated = await api(adminToken)
        .patch(`/inventories/${created.id}`)
        .send({
          date: addDays(today, -2),
          generalNotes: 'Todo a la vista',
          tenantAcknowledged: true,
          items: [
            {
              id: first.id,
              category: first.category,
              description: 'Mesada de granito',
              condition: 'FAIR',
              notes: '  rayón chico ',
            },
            {
              category: 'Patio',
              description: 'Parrilla',
              condition: 'POOR',
              notes: null,
            },
          ],
        })
        .expect(200)

      expect(updated.body.data).toMatchObject({
        date: addDays(today, -2),
        generalNotes: 'Todo a la vista',
        tenantAcknowledged: true,
        itemCount: 2,
        poorCount: 1,
      })
      expect(updated.body.data.items[0]).toMatchObject({
        id: first.id,
        description: 'Mesada de granito',
        condition: 'FAIR',
        notes: 'rayón chico',
      })
      expect(updated.body.data.items[1]).toMatchObject({
        category: 'Patio',
        description: 'Parrilla',
      })
      expect(updated.body.data.items.map((i: any) => i.id)).not.toContain(
        second.id,
      )

      // Sin `items` no toca la lista; un id ajeno es 404.
      const notes = await api(adminToken)
        .patch(`/inventories/${created.id}`)
        .send({ generalNotes: null })
        .expect(200)
      expect(notes.body.data.generalNotes).toBeNull()
      expect(notes.body.data.itemCount).toBe(2)
      const foreign = await api(adminToken)
        .patch(`/inventories/${created.id}`)
        .send({
          items: [
            {
              id: second.id,
              category: 'X',
              description: 'Y',
              condition: 'GOOD',
              notes: null,
            },
          ],
        })
        .expect(404)
      expect(foreign.body.code).toBe('INVENTORY_ITEM_NOT_FOUND')
      await api(adminToken)
        .patch(`/inventories/${created.id}`)
        .send({
          items: [{ category: '', description: 'a', condition: 'GOOD' }],
        })
        .expect(400)
      await api(adminToken)
        .patch(`/inventories/${created.id}`)
        .send({ tenantAcknowledged: 'si' })
        .expect(400)
    })
  })

  describe('fotos', () => {
    it('sube, cuenta y borra fotos; borrar un ítem se lleva las suyas', async () => {
      const contractId = await createContract()
      const inventory = await evaluate(await createInventory(contractId))
      const [first, second] = inventory.items

      const uploaded = await uploadPhotos(inventory.id, first.id, [
        JPG,
        PNG,
      ]).expect(201)
      expect(uploaded.body.data.photoCount).toBe(2)
      expect(uploaded.body.data.items[0].photos).toHaveLength(2)
      expect(uploaded.body.data.items[0].photos[0].url).toEqual(
        expect.any(String),
      )

      // Un aviso por el ítem en mal estado (el segundo) sin fotos.
      expect(uploaded.body.data.warnings).toEqual([
        `${second.category} · ${second.description}: está en mal estado y no tiene fotos`,
      ])

      const photoId = uploaded.body.data.items[0].photos[0].id
      const removed = await api(adminToken)
        .delete(`/inventories/${inventory.id}/photos/${photoId}`)
        .expect(200)
      expect(removed.body.data.photoCount).toBe(1)

      await uploadPhotos(inventory.id, second.id, [JPG]).expect(201)
      const dropped = await api(adminToken)
        .patch(`/inventories/${inventory.id}`)
        .send({
          items: [
            {
              id: first.id,
              category: first.category,
              description: first.description,
              condition: 'GOOD',
              notes: null,
            },
          ],
        })
        .expect(200)
      expect(dropped.body.data.photoCount).toBe(1)
      expect(await prisma.inventoryPhoto.count()).toBe(1)
    })

    it('rechaza archivos que no son fotos, sin archivos, y pasarse del máximo', async () => {
      const contractId = await createContract()
      const inventory = await createInventory(contractId)
      const itemId = inventory.items[0].id

      const pdf = await uploadPhotos(inventory.id, itemId, [JPG, PDF]).expect(
        400,
      )
      expect(pdf.body.code).toBe('INVENTORY_INVALID_PHOTO')
      expect(await prisma.inventoryPhoto.count()).toBe(0)

      await api(adminToken)
        .post(`/inventories/${inventory.id}/items/${itemId}/photos`)
        .expect(400)

      await uploadPhotos(inventory.id, itemId, Array(6).fill(JPG)).expect(400)

      for (let i = 0; i < 3; i++) {
        await uploadPhotos(inventory.id, itemId, Array(5).fill(JPG)).expect(201)
      }
      const tooMany = await uploadPhotos(inventory.id, itemId, [JPG]).expect(
        400,
      )
      expect(tooMany.body.code).toBe('INVENTORY_TOO_MANY_PHOTOS')

      const unknownItem = await uploadPhotos(inventory.id, UNKNOWN_ID, [
        JPG,
      ]).expect(404)
      expect(unknownItem.body.code).toBe('INVENTORY_ITEM_NOT_FOUND')
      const unknownPhoto = await api(adminToken)
        .delete(`/inventories/${inventory.id}/photos/${UNKNOWN_ID}`)
        .expect(404)
      expect(unknownPhoto.body.code).toBe('INVENTORY_PHOTO_NOT_FOUND')
    })
  })

  describe('confirmación', () => {
    it('exige al menos un ítem evaluado', async () => {
      const contractId = await createContract()
      const inventory = await createInventory(contractId)
      const response = await api(adminToken)
        .post(`/inventories/${inventory.id}/confirm`)
        .expect(422)
      expect(response.body.code).toBe('INVENTORY_EMPTY')
    })

    it('confirma con avisos, queda inmutable y registra quién y cuándo', async () => {
      const contractId = await createContract()
      const inventory = await evaluate(await createInventory(contractId))

      const confirmed = await api(employeeToken)
        .post(`/inventories/${inventory.id}/confirm`)
        .expect(200)
      expect(confirmed.body.data).toMatchObject({
        status: 'CONFIRMED',
        poorCount: 1,
      })
      expect(confirmed.body.data.confirmedAt).toEqual(expect.any(String))
      expect(confirmed.body.data.warnings).toHaveLength(1)

      const locked = async (response: request.Test) => {
        const res = await response.expect(409)
        expect(res.body.code).toBe('INVENTORY_CONFIRMED')
      }
      await locked(
        api(adminToken).patch(`/inventories/${inventory.id}`).send({
          generalNotes: 'cambio',
        }),
      )
      await locked(uploadPhotos(inventory.id, inventory.items[0].id, [JPG]))
      await locked(api(adminToken).post(`/inventories/${inventory.id}/confirm`))

      const row = await prisma.propertyInventory.findUniqueOrThrow({
        where: { id: inventory.id },
      })
      expect(row.confirmedById).not.toBeNull()
    })
  })

  describe('devolución y comparación', () => {
    it('no se habilita con el contrato activo y lejos del fin', async () => {
      const contractId = await createContract()
      const list = await api(adminToken)
        .get(`/contracts/${contractId}/inventories`)
        .expect(200)
      expect(list.body.data.canCreateReturn).toBe(false)

      const response = await api(adminToken)
        .post(`/contracts/${contractId}/inventories`)
        .send({ type: 'RETURN' })
        .expect(422)
      expect(response.body.code).toBe('INVENTORY_RETURN_NOT_ALLOWED')
    })

    it('se habilita a 30 días del fin o con el contrato rescindido', async () => {
      const near = await createContract()
      await prisma.contract.update({
        where: { id: near },
        data: { endDate: new Date(`${addDays(today, 30)}T00:00:00.000Z`) },
      })
      expect(
        (await api(adminToken).get(`/contracts/${near}/inventories`)).body.data
          .canCreateReturn,
      ).toBe(true)
      await createInventory(near, { type: 'RETURN' })

      const terminated = await createContract()
      await prisma.contract.update({
        where: { id: terminated },
        data: { status: 'TERMINATED' },
      })
      await createInventory(terminated, { type: 'RETURN' })
    })

    it('compara la entrega con la devolución y cuenta lo que empeoró', async () => {
      const contractId = await createContract()
      const delivery = await evaluate(await createInventory(contractId), [
        'GOOD',
        'FAIR',
        'POOR',
        'GOOD',
      ])
      await uploadPhotos(delivery.id, delivery.items[0].id, [JPG]).expect(201)
      await api(adminToken)
        .post(`/inventories/${delivery.id}/confirm`)
        .expect(200)

      await prisma.contract.update({
        where: { id: contractId },
        data: { status: 'FINISHED' },
      })
      const returned = await evaluate(
        await createInventory(contractId, { type: 'RETURN' }),
        ['POOR', 'FAIR', 'GOOD', 'NOT_APPLICABLE'],
      )
      await api(adminToken)
        .post(`/inventories/${returned.id}/confirm`)
        .expect(200)

      const response = await api(adminToken)
        .get(`/contracts/${contractId}/inventories/compare`)
        .expect(200)
      const comparison = response.body.data
      expect(comparison).toMatchObject({
        hasDelivery: true,
        hasReturn: true,
        deliveryDate: today,
        returnDate: today,
        worsenedCount: 1,
      })
      expect(comparison.rows.slice(0, 4).map((r: any) => r.change)).toEqual([
        'WORSE',
        'SAME',
        'BETTER',
        'SAME',
      ])
      expect(comparison.rows[0]).toMatchObject({
        deliveryCondition: 'GOOD',
        returnCondition: 'POOR',
      })
      expect(comparison.rows[0].deliveryPhotos).toHaveLength(1)
      expect(comparison.rows[0].returnPhotos).toEqual([])
    })

    it('sin entrega lo avisa; un borrador no cuenta como acta', async () => {
      const contractId = await createContract()
      await prisma.contract.update({
        where: { id: contractId },
        data: { status: 'TERMINATED' },
      })
      await createInventory(contractId) // entrega en borrador
      const returned = await evaluate(
        await createInventory(contractId, { type: 'RETURN' }),
      )
      await api(adminToken)
        .post(`/inventories/${returned.id}/confirm`)
        .expect(200)

      const { body } = await api(adminToken)
        .get(`/contracts/${contractId}/inventories/compare`)
        .expect(200)
      expect(body.data).toMatchObject({
        hasDelivery: false,
        hasReturn: true,
        deliveryDate: null,
        worsenedCount: 0,
      })
      expect(body.data.rows.every((r: any) => r.change === 'ONLY_RETURN')).toBe(
        true,
      )
    })
  })

  describe('corrección (A-42)', () => {
    it('copia el confirmado en un borrador y, al confirmarlo, lo reemplaza', async () => {
      const contractId = await createContract()
      const original = await evaluate(await createInventory(contractId))
      await uploadPhotos(original.id, original.items[0].id, [JPG]).expect(201)
      await api(adminToken)
        .post(`/inventories/${original.id}/confirm`)
        .expect(200)

      const correction = (
        await api(adminToken)
          .post(`/inventories/${original.id}/correct`)
          .send({ reason: 'El piso estaba mal evaluado' })
          .expect(201)
      ).body.data
      expect(correction).toMatchObject({
        status: 'DRAFT',
        type: 'DELIVERY',
        correctsInventoryId: original.id,
        correctionReason: 'El piso estaba mal evaluado',
        tenantAcknowledged: false,
        itemCount: original.itemCount,
        photoCount: 1,
      })
      expect(correction.id).not.toBe(original.id)

      // Mientras tanto siguen los dos; no se puede pedir otra corrección ni crear otra entrega.
      const duplicate = await api(adminToken)
        .post(`/inventories/${original.id}/correct`)
        .send({ reason: 'otra vez' })
        .expect(409)
      expect(duplicate.body.code).toBe('INVENTORY_CORRECTION_PENDING')
      const midway = await api(adminToken)
        .get(`/contracts/${contractId}/inventories`)
        .expect(200)
      expect(midway.body.data.inventories).toHaveLength(2)
      expect(midway.body.data.canCreateDelivery).toBe(false)

      // Se corrige: la foto copiada se saca de la corrección sin tocar el original.
      const copiedPhoto = correction.items[0].photos[0].id
      await api(adminToken)
        .delete(`/inventories/${correction.id}/photos/${copiedPhoto}`)
        .expect(200)
      const untouched = await api(adminToken)
        .get(`/inventories/${original.id}`)
        .expect(200)
      expect(untouched.body.data.photoCount).toBe(1)

      await evaluate(correction, ['FAIR', 'POOR'])
      const confirmed = await api(adminToken)
        .post(`/inventories/${correction.id}/confirm`)
        .expect(200)
      expect(confirmed.body.data.status).toBe('CONFIRMED')

      const after = await api(adminToken)
        .get(`/contracts/${contractId}/inventories`)
        .expect(200)
      expect(after.body.data.inventories.map((i: any) => i.id)).toEqual([
        correction.id,
      ])
      const stale = await api(adminToken)
        .post(`/inventories/${original.id}/correct`)
        .send({ reason: 'ya reemplazado' })
        .expect(409)
      expect(stale.body.code).toBe('INVENTORY_SUPERSEDED')

      // El original sigue legible y la comparación usa la vigente.
      await api(adminToken).get(`/inventories/${original.id}`).expect(200)
    })

    it('un borrador se edita, no se corrige; el motivo es obligatorio', async () => {
      const contractId = await createContract()
      const draft = await createInventory(contractId)
      const response = await api(adminToken)
        .post(`/inventories/${draft.id}/correct`)
        .send({ reason: 'quiero cambiar algo' })
        .expect(409)
      expect(response.body.code).toBe('INVENTORY_NOT_CONFIRMED')
      await api(adminToken)
        .post(`/inventories/${draft.id}/correct`)
        .send({})
        .expect(400)
    })
  })

  describe('permisos', () => {
    it('exige sesión', async () => {
      const contractId = await createContract()
      const inventory = await createInventory(contractId)
      await request(app.getHttpServer())
        .get(`/api/v1/contracts/${contractId}/inventories`)
        .expect(401)
      await request(app.getHttpServer())
        .get(`/api/v1/inventories/${inventory.id}`)
        .expect(401)
      await request(app.getHttpServer())
        .post(`/api/v1/inventories/${inventory.id}/confirm`)
        .expect(401)
    })

    it('el portal (propietarios e inquilinos) no entra', async () => {
      const contractId = await createContract()
      const inventory = await createInventory(contractId)
      await createUser(prisma, {
        tenantId: tenantA.id,
        email: 'duenio@a.com',
        role: Role.OWNER,
      })
      await createUser(prisma, {
        tenantId: tenantA.id,
        email: 'inquilino@a.com',
        role: Role.RENTER,
      })
      const owner = await loginToPortalAs(
        app,
        'tenant-a',
        'duenio@a.com',
        'OWNER',
      )
      const renter = await loginToPortalAs(
        app,
        'tenant-a',
        'inquilino@a.com',
        'RENTER',
      )
      for (const token of [owner, renter]) {
        await api(token).get(`/contracts/${contractId}/inventories`).expect(403)
        await api(token)
          .get(`/contracts/${contractId}/inventories/compare`)
          .expect(403)
        await api(token).get(`/inventories/${inventory.id}`).expect(403)
        await api(token)
          .post(`/contracts/${contractId}/inventories`)
          .send({ type: 'DELIVERY' })
          .expect(403)
        await api(token)
          .post(`/inventories/${inventory.id}/confirm`)
          .expect(403)
      }
    })

    it('el empleado hace todo el flujo', async () => {
      const contractId = await createContract(employeeToken)
      const inventory = await evaluate(
        await createInventory(contractId, { type: 'DELIVERY' }, employeeToken),
        ['GOOD'],
        employeeToken,
      )
      await uploadPhotos(
        inventory.id,
        inventory.items[0].id,
        [JPG],
        employeeToken,
      ).expect(201)
      await api(employeeToken)
        .post(`/inventories/${inventory.id}/confirm`)
        .expect(200)
      await api(employeeToken)
        .post(`/inventories/${inventory.id}/correct`)
        .send({ reason: 'Motivo de prueba' })
        .expect(201)
    })
  })

  describe('aislamiento entre inmobiliarias', () => {
    it('la otra inmobiliaria no ve ni toca nada', async () => {
      const contractId = await createContract()
      const inventory = await evaluate(await createInventory(contractId))
      const itemId = inventory.items[0].id
      const uploaded = await uploadPhotos(inventory.id, itemId, [JPG]).expect(
        201,
      )
      const photoId = uploaded.body.data.items[0].photos[0].id

      const b = api(adminBToken)
      await b.get(`/contracts/${contractId}/inventories`).expect(404)
      await b.get(`/contracts/${contractId}/inventories/compare`).expect(404)
      await b
        .post(`/contracts/${contractId}/inventories`)
        .send({ type: 'DELIVERY' })
        .expect(404)
      await b.get(`/inventories/${inventory.id}`).expect(404)
      await b
        .patch(`/inventories/${inventory.id}`)
        .send({ generalNotes: 'intruso' })
        .expect(404)
      await uploadPhotos(inventory.id, itemId, [JPG], adminBToken).expect(404)
      await b
        .delete(`/inventories/${inventory.id}/photos/${photoId}`)
        .expect(404)
      await b.post(`/inventories/${inventory.id}/confirm`).expect(404)

      await api(adminToken)
        .post(`/inventories/${inventory.id}/confirm`)
        .expect(200)
      await b
        .post(`/inventories/${inventory.id}/correct`)
        .send({ reason: 'intruso' })
        .expect(404)

      // Nada cambió del lado de A.
      const mine = await api(adminToken)
        .get(`/inventories/${inventory.id}`)
        .expect(200)
      expect(mine.body.data).toMatchObject({
        generalNotes: null,
        status: 'CONFIRMED',
        photoCount: 1,
      })

      // Y la otra inmobiliaria arma los suyos sin cruzarse con los de A.
      const contractB = await createContract(adminBToken, refsB)
      const own = await createInventory(
        contractB,
        { type: 'DELIVERY' },
        adminBToken,
      )
      expect(own.contractId).toBe(contractB)
      const listB = await b
        .get(`/contracts/${contractB}/inventories`)
        .expect(200)
      expect(listB.body.data.inventories.map((i: any) => i.id)).toEqual([
        own.id,
      ])
      await api(adminToken).get(`/inventories/${own.id}`).expect(404)
      expect(
        await prisma.propertyInventory.count({
          where: { tenantId: tenantB.id },
        }),
      ).toBe(1)
    })
  })
})
