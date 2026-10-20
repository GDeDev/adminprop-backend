import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import request from 'supertest'

import { seedBaseMasterData } from '../prisma/lib/master-data-seed'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'

/** PNG de 1x1: el validador revisa el contenido real, no sólo el mimetype. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

/** Propiedades (spec Fase 6): criterios de aceptación, casos borde y aislamiento. */
describe('Propiedades (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string }
  let adminToken: string
  let employeeToken: string
  let refs: {
    tolosa: string
    laPlata: string
    buenosAires: string
    casa: string
    departamento: string
    pileta: string
    cochera: string
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
    await seedBaseMasterData(prisma, tenantA.id, { withSampleCities: true })
    await createUser(prisma, {
      tenantId: tenantA.id,
      email: 'admin@a.com',
      role: Role.ADMIN,
    })
    await createUser(prisma, { tenantId: tenantA.id, email: 'emp@a.com' })
    adminToken = await loginAs(app, 'admin@a.com')
    employeeToken = await loginAs(app, 'emp@a.com')

    const location = (name: string) =>
      prisma.location
        .findFirstOrThrow({ where: { tenantId: tenantA.id, name } })
        .then((l) => l.id)
    const type = (name: string) =>
      prisma.propertyType
        .findFirstOrThrow({ where: { tenantId: tenantA.id, name } })
        .then((t) => t.id)
    const amenity = (name: string) =>
      prisma.amenity
        .findFirstOrThrow({ where: { tenantId: tenantA.id, name } })
        .then((a) => a.id)
    refs = {
      tolosa: await location('Tolosa'),
      laPlata: await location('La Plata'),
      buenosAires: await location('Buenos Aires'),
      casa: await type('Casa'),
      departamento: await type('Departamento'),
      pileta: await amenity('Pileta'),
      cochera: await amenity('Cochera'),
    }
  })

  const as =
    (token: string) =>
    (method: 'get' | 'post' | 'patch' | 'delete', url: string) =>
      request(app.getHttpServer())
        [method](`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`)
  const api = (method: 'get' | 'post' | 'patch' | 'delete', url: string) =>
    as(employeeToken)(method, url)

  const create = (overrides: Record<string, unknown> = {}) =>
    api('post', '/properties').send({
      address: 'Calle 7 1234',
      locationId: refs.tolosa,
      propertyTypeId: refs.casa,
      amenityIds: [refs.pileta],
      ...overrides,
    })

  describe('alta', () => {
    it('con datos válidos: 201, queda disponible y trae los maestros expandidos', async () => {
      const response = await create({ notes: '  Llave en portería ' }).expect(
        201,
      )

      expect(response.body.data).toMatchObject({
        address: 'Calle 7 1234',
        status: 'AVAILABLE',
        ownerId: null,
        notes: 'Llave en portería',
        propertyType: { name: 'Casa' },
        location: {
          name: 'Tolosa',
          path: 'Tolosa, La Plata, Buenos Aires',
        },
        amenities: [{ name: 'Pileta', icon: 'waves' }],
        photos: [],
        mainPhotoUrl: null,
      })
    })

    it('sin dirección: 400', async () => {
      const response = await create({ address: '   ' }).expect(400)

      expect(response.body.errors[0].field).toBe('address')
    })

    it('con un maestro desactivado o una ubicación demasiado general: 422', async () => {
      await prisma.propertyType.update({
        where: { id: refs.departamento },
        data: { isActive: false },
      })

      const inactiveType = await create({
        propertyTypeId: refs.departamento,
      }).expect(422)
      const province = await create({ locationId: refs.buenosAires }).expect(
        422,
      )

      expect(inactiveType.body.code).toBe('PROPERTY_INVALID_MASTER_DATA')
      expect(province.body.message).toBe('Elegí una localidad o un barrio')
    })
  })

  describe('listado', () => {
    beforeEach(async () => {
      await create({ address: 'Av. Corrientes 1234' }).expect(201)
      await create({ address: 'Avenida Corrientes 500' }).expect(201)
      const other = await create({ address: 'Calle 50 800' }).expect(201)
      await api('patch', `/properties/${other.body.data.id}/status`)
        .send({ status: 'MAINTENANCE' })
        .expect(200)
    })

    it('filtra por estado', async () => {
      const { body } = await api('get', '/properties?status=AVAILABLE').expect(
        200,
      )

      expect(body.data.pagination.total).toBe(2)
      expect(
        body.data.data.every(
          (p: { status: string }) => p.status === 'AVAILABLE',
        ),
      ).toBe(true)
    })

    it('busca por parte de la dirección, sin mayúsculas', async () => {
      const { body } = await api('get', '/properties?search=corrientes').expect(
        200,
      )

      expect(
        body.data.data.map((p: { address: string }) => p.address).sort(),
      ).toEqual(['Av. Corrientes 1234', 'Avenida Corrientes 500'])
    })

    it('pagina y trae el tipo y la ubicación de cada una', async () => {
      const { body } = await api('get', '/properties?limit=2').expect(200)

      expect(body.data.data).toHaveLength(2)
      expect(body.data.pagination).toMatchObject({
        total: 3,
        hasNextPage: true,
      })
      expect(body.data.data[0].propertyType.name).toBe('Casa')
    })
  })

  describe('edición', () => {
    it('edita datos pero conserva un maestro que después se desactivó', async () => {
      const created = await create({
        propertyTypeId: refs.departamento,
      }).expect(201)
      await prisma.propertyType.update({
        where: { id: refs.departamento },
        data: { isActive: false },
      })

      const response = await api('patch', `/properties/${created.body.data.id}`)
        .send({
          address: 'Calle 7 1300',
          propertyTypeId: refs.departamento,
          amenityIds: [refs.pileta, refs.cochera],
        })
        .expect(200)

      expect(response.body.data).toMatchObject({
        address: 'Calle 7 1300',
        propertyType: { name: 'Departamento', isActive: false },
      })
      expect(response.body.data.amenities).toHaveLength(2)
    })
  })

  describe('estado', () => {
    it('sin contrato: se puede alquilar a mano (reserva) y volver a disponible', async () => {
      const { body } = await create().expect(201)
      const id = body.data.id

      await api('patch', `/properties/${id}/status`)
        .send({ status: 'RENTED' })
        .expect(200)
      const back = await api('patch', `/properties/${id}/status`)
        .send({ status: 'AVAILABLE' })
        .expect(200)

      expect(back.body.data.status).toBe('AVAILABLE')
    })

    it('de mantenimiento a alquilada no: 422', async () => {
      const { body } = await create().expect(201)
      await api('patch', `/properties/${body.data.id}/status`)
        .send({ status: 'MAINTENANCE' })
        .expect(200)

      const response = await api('patch', `/properties/${body.data.id}/status`)
        .send({ status: 'RENTED' })
        .expect(422)

      expect(response.body.code).toBe('PROPERTY_INVALID_STATUS_TRANSITION')
    })
  })

  describe('fotos', () => {
    it('sube, la primera es la principal, y borra el archivo al quitarla', async () => {
      const { body } = await create().expect(201)
      const id = body.data.id

      const uploaded = await api('post', `/properties/${id}/photos`)
        .attach('files', PNG, { filename: 'a.png', contentType: 'image/png' })
        .attach('files', PNG, { filename: 'b.png', contentType: 'image/png' })
        .expect(201)

      const photos = uploaded.body.data.photos
      expect(photos.map((p: { position: number }) => p.position)).toEqual([
        0, 1,
      ])
      expect(uploaded.body.data.mainPhotoUrl).toBe(photos[0].url)

      const stored = await prisma.propertyPhoto.findUniqueOrThrow({
        where: { id: photos[0].id },
      })
      const file = join(process.env.STORAGE_LOCAL_DIR ?? '', stored.storageKey)
      expect(existsSync(file)).toBe(true)

      const after = await api(
        'delete',
        `/properties/${id}/photos/${photos[0].id}`,
      ).expect(200)
      expect(after.body.data.photos).toHaveLength(1)
      expect(existsSync(file)).toBe(false)
    })

    it('la foto 21 es un 400 y no sube nada', async () => {
      const { body } = await create().expect(201)
      const id = body.data.id
      await prisma.propertyPhoto.createMany({
        data: Array.from({ length: 20 }, (_, i) => ({
          tenantId: tenantA.id,
          propertyId: id,
          storageKey: `tenants/${tenantA.id}/fake-${i}.png`,
          url: `http://x/${i}.png`,
          position: i,
        })),
      })

      const response = await api('post', `/properties/${id}/photos`)
        .attach('files', PNG, { filename: 'x.png', contentType: 'image/png' })
        .expect(400)

      expect(response.body.code).toBe('PROPERTY_TOO_MANY_PHOTOS')
      expect(await prisma.propertyPhoto.count()).toBe(20)
    })

    it('rechaza un archivo que no es imagen', async () => {
      const { body } = await create().expect(201)

      await api('post', `/properties/${body.data.id}/photos`)
        .attach('files', Buffer.from('#!/bin/sh'), {
          filename: 'x.png',
          contentType: 'image/png',
        })
        .expect(400)
    })
  })

  describe('borrado', () => {
    it('sólo un admin; es lógico y después la propiedad no existe', async () => {
      const { body } = await create().expect(201)
      const id = body.data.id

      await api('delete', `/properties/${id}`).expect(403)
      await as(adminToken)('delete', `/properties/${id}`).expect(204)

      await api('get', `/properties/${id}`).expect(404)
      const row = await prisma.property.findUniqueOrThrow({ where: { id } })
      expect(row.deletedAt).not.toBeNull()
    })
  })

  describe('aislamiento entre inmobiliarias', () => {
    it('otra inmobiliaria no ve ni toca una propiedad, ni por id directo', async () => {
      const { body } = await create().expect(201)
      const id = body.data.id
      const tenantB = await createTenant(prisma, 'tenant-b')
      await createUser(prisma, {
        tenantId: tenantB.id,
        email: 'admin@b.com',
        role: Role.ADMIN,
      })
      const b = as(await loginAs(app, 'admin@b.com'))

      await b('get', `/properties/${id}`).expect(404)
      await b('patch', `/properties/${id}`).send({ address: 'X' }).expect(404)
      await b('delete', `/properties/${id}`).expect(404)
      const list = await b('get', '/properties').expect(200)
      expect(list.body.data.pagination.total).toBe(0)

      // Tampoco puede usar los maestros de A en sus altas.
      await seedBaseMasterData(prisma, tenantB.id)
      const typeB = await prisma.propertyType.findFirstOrThrow({
        where: { tenantId: tenantB.id, name: 'Casa' },
      })
      await b('post', '/properties')
        .send({
          address: 'Calle falsa 123',
          locationId: refs.tolosa,
          propertyTypeId: typeB.id,
        })
        .expect(422)
    })
  })
})
