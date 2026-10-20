import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import request from 'supertest'

import { seedBaseMasterData } from '../prisma/lib/master-data-seed'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'

/** Maestros (spec Fase 5): criterios de aceptación, casos borde y aislamiento. */
describe('Maestros (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string }
  let tenantB: { id: string }
  let adminToken: string
  let employeeToken: string

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
    await seedBaseMasterData(prisma, tenantB.id)
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
  })

  const as =
    (token: string) => (method: 'get' | 'post' | 'patch', url: string) =>
      request(app.getHttpServer())
        [method](`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`)
  const admin = (method: 'get' | 'post' | 'patch', url: string) =>
    as(adminToken)(method, url)

  const findType = async (name: string) => {
    const { body } = await admin('get', '/property-types?isActive=all')
    return body.data.find((t: { name: string }) => t.name === name)
  }

  describe('seed', () => {
    it('carga el catálogo base y no duplica si corre de nuevo', async () => {
      const again = await seedBaseMasterData(prisma, tenantA.id, {
        withSampleCities: true,
      })

      expect(again.created).toBe(0)
      const { body } = await admin('get', '/property-types')
      expect(body.data.map((t: { name: string }) => t.name)).toEqual([
        'Casa',
        'Departamento',
        'Local',
        'Oficina',
        'PH',
        'Terreno',
      ])
      const amenities = await admin('get', '/amenities').expect(200)
      expect(amenities.body.data).toContainEqual(
        expect.objectContaining({ name: 'Pileta', icon: 'waves' }),
      )
    })
  })

  describe('maestros planos', () => {
    it('un empleado los puede leer pero no crear ni editar: 403', async () => {
      const employee = as(employeeToken)
      await employee('get', '/property-types').expect(200)

      const create = await employee('post', '/property-types')
        .send({ name: 'Dúplex' })
        .expect(403)
      expect(create.body.code).toBe('INSUFFICIENT_PERMISSIONS')

      const casa = await findType('Casa')
      await employee('patch', `/property-types/${casa.id}`)
        .send({ name: 'Casona' })
        .expect(403)
      await employee('patch', `/property-types/${casa.id}/deactivate`).expect(
        403,
      )
    })

    it('un admin crea, renombra y desactiva', async () => {
      const created = await admin('post', '/service-types')
        .send({ name: '  ABL  ' })
        .expect(201)
      expect(created.body.data).toMatchObject({ name: 'ABL', isActive: true })

      await admin('patch', `/service-types/${created.body.data.id}`)
        .send({ name: 'Tasa municipal ABL' })
        .expect(200)
    })

    it('desactivar lo saca del listado por defecto pero sigue existiendo', async () => {
      const casa = await findType('Casa')

      await admin('patch', `/property-types/${casa.id}/deactivate`).expect(200)

      const active = await admin('get', '/property-types').expect(200)
      expect(active.body.data.map((t: { id: string }) => t.id)).not.toContain(
        casa.id,
      )
      const inactive = await admin(
        'get',
        '/property-types?isActive=false',
      ).expect(200)
      expect(inactive.body.data.map((t: { id: string }) => t.id)).toEqual([
        casa.id,
      ])
      // Un registro viejo que lo usa lo puede seguir mostrando.
      await admin('get', `/property-types/${casa.id}`).expect(200)

      await admin('patch', `/property-types/${casa.id}/activate`).expect(200)
      expect((await findType('Casa')).isActive).toBe(true)
    })

    it('un nombre repetido, aunque cambie mayúsculas, es 409', async () => {
      const response = await admin('post', '/property-types')
        .send({ name: 'casa' })
        .expect(409)

      expect(response.body.code).toBe('MASTER_DATA_NAME_TAKEN')
    })

    it('amenities guardan el ícono y lo validan', async () => {
      const created = await admin('post', '/amenities')
        .send({ name: 'Gimnasio', icon: 'dumbbell' })
        .expect(201)
      expect(created.body.data.icon).toBe('dumbbell')

      await admin('post', '/amenities')
        .send({ name: 'Sauna', icon: '<script>' })
        .expect(400)
    })

    it('no existe borrado: no hay DELETE', async () => {
      const casa = await findType('Casa')

      await admin('get', `/property-types/${casa.id}`).expect(200)
      await request(app.getHttpServer())
        .delete(`/api/v1/property-types/${casa.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404)
    })
  })

  describe('ubicaciones', () => {
    it('GET /locations/tree devuelve la jerarquía anidada', async () => {
      const { body } = await admin('get', '/locations/tree').expect(200)

      expect(body.data).toHaveLength(1)
      const argentina = body.data[0]
      expect(argentina).toMatchObject({ name: 'Argentina', level: 'COUNTRY' })
      const buenosAires = argentina.children.find(
        (p: { name: string }) => p.name === 'Buenos Aires',
      )
      expect(buenosAires.children.map((c: { name: string }) => c.name)).toEqual(
        ['La Plata', 'Quilmes'],
      )
      expect(buenosAires.children[0].children[0]).toMatchObject({
        name: 'Centro',
        level: 'NEIGHBORHOOD',
        children: [],
      })
    })

    it('filtra por padre para los selects en cascada', async () => {
      const [laPlata] = (
        await admin('get', '/locations?level=CITY').expect(200)
      ).body.data.filter((l: { name: string }) => l.name === 'La Plata')

      const { body } = await admin(
        'get',
        `/locations?parentId=${laPlata.id}`,
      ).expect(200)

      expect(body.data.map((l: { name: string }) => l.name)).toEqual([
        'Centro',
        'City Bell',
        'Tolosa',
      ])
    })

    it('crear un barrio sin padre es 400', async () => {
      const response = await admin('post', '/locations')
        .send({ level: 'NEIGHBORHOOD', name: 'Palermo Chico' })
        .expect(400)

      expect(response.body.errors[0].field).toBe('parentId')
    })

    it('el padre tiene que ser de un nivel más general: 422', async () => {
      const [tolosa] = (
        await admin('get', '/locations?level=NEIGHBORHOOD').expect(200)
      ).body.data.filter((l: { name: string }) => l.name === 'Tolosa')

      const response = await admin('post', '/locations')
        .send({ level: 'CITY', name: 'Ensenada', parentId: tolosa.id })
        .expect(422)

      expect(response.body.code).toBe('LOCATION_INVALID_PARENT')
    })

    it('dos barrios con el mismo nombre bajo la misma localidad: 409; bajo otra, sí', async () => {
      const cities = (await admin('get', '/locations?level=CITY')).body.data
      const laPlata = cities.find(
        (c: { name: string }) => c.name === 'La Plata',
      )
      const quilmes = cities.find((c: { name: string }) => c.name === 'Quilmes')

      const duplicate = await admin('post', '/locations')
        .send({ level: 'NEIGHBORHOOD', name: 'TOLOSA', parentId: laPlata.id })
        .expect(409)
      expect(duplicate.body.code).toBe('LOCATION_NAME_TAKEN')

      await admin('post', '/locations')
        .send({ level: 'NEIGHBORHOOD', name: 'Tolosa', parentId: quilmes.id })
        .expect(201)
    })

    it('se puede reactivar una ubicación con el padre desactivado', async () => {
      const cities = (await admin('get', '/locations?level=CITY')).body.data
      const laPlata = cities.find(
        (c: { name: string }) => c.name === 'La Plata',
      )
      const [centro] = (await admin('get', `/locations?parentId=${laPlata.id}`))
        .body.data

      await admin('patch', `/locations/${centro.id}/deactivate`).expect(200)
      await admin('patch', `/locations/${laPlata.id}/deactivate`).expect(200)

      const reactivated = await admin(
        'patch',
        `/locations/${centro.id}/activate`,
      ).expect(200)
      expect(reactivated.body.data.isActive).toBe(true)
    })

    it('un empleado no crea ubicaciones: 403', async () => {
      await as(employeeToken)('post', '/locations')
        .send({ level: 'COUNTRY', name: 'Uruguay' })
        .expect(403)
    })
  })

  describe('aislamiento entre inmobiliarias', () => {
    it('cada inmobiliaria ve y edita sólo sus maestros, ni por id directo', async () => {
      const bToken = await loginAs(app, 'admin@b.com')
      const adminB = as(bToken)
      const casaA = await findType('Casa')

      await adminB('get', `/property-types/${casaA.id}`).expect(404)
      await adminB('patch', `/property-types/${casaA.id}`)
        .send({ name: 'Hackeada' })
        .expect(404)
      await adminB('patch', `/property-types/${casaA.id}/deactivate`).expect(
        404,
      )
      expect((await findType('Casa')).isActive).toBe(true)

      // B puede tener su propio "Dúplex" aunque A también lo tenga.
      await admin('post', '/property-types')
        .send({ name: 'Dúplex' })
        .expect(201)
      await adminB('post', '/property-types')
        .send({ name: 'Dúplex' })
        .expect(201)

      // B no tiene los barrios de ejemplo de A, y no puede colgar nada de ellos.
      const treeB = await adminB('get', '/locations/tree').expect(200)
      const citiesB = treeB.body.data[0].children.flatMap(
        (p: { children: unknown[] }) => p.children,
      )
      expect(citiesB).toEqual([])
      const laPlataA = (
        await admin('get', '/locations?level=CITY')
      ).body.data.find((c: { name: string }) => c.name === 'La Plata')
      await adminB('post', '/locations')
        .send({ level: 'NEIGHBORHOOD', name: 'Intruso', parentId: laPlataA.id })
        .expect(422)
    })
  })
})
