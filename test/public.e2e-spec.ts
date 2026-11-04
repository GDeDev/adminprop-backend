import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import request from 'supertest'

import { seedBaseMasterData } from '../prisma/lib/master-data-seed'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'
import { waitFor } from './utils/wait-for'

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

/** Portal público (Fase 22): listado, ficha, filtros, contacto y consultas del personal. */
describe('Portal público (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string }
  let tenantB: { id: string }
  let adminToken: string
  let employeeToken: string
  let adminBToken: string
  let refs: { tolosa: string; city: string; casa: string; depto: string }
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

  /** Sin token: lo que hace el portal. */
  const pub = {
    get: (url: string) => request(app.getHttpServer()).get(`/api/v1${url}`),
    post: (url: string) => request(app.getHttpServer()).post(`/api/v1${url}`),
  }

  const createProperty = async (
    body: Record<string, unknown>,
    token = adminToken,
    master: { tolosa: string; casa: string } = refs,
  ) => {
    const response = await api(token)
      .post('/properties')
      .send({
        address: 'Calle 1',
        locationId: master.tolosa,
        propertyTypeId: master.casa,
        ...body,
      })
      .expect(201)
    return response.body.data as { id: string }
  }

  const setStatus = (id: string, status: string, token = adminToken) =>
    api(token).patch(`/properties/${id}/status`).send({ status }).expect(200)

  const contact = (slug: string, body: Record<string, unknown> = {}) =>
    pub.post(`/public/${slug}/contact`).send({
      name: 'Ana Pérez',
      email: 'ana@mail.com',
      phone: '221 555 1234',
      message: 'Me interesa la propiedad',
      propertyId: null,
      website: '',
      ...body,
    })

  const alertsOf = async (token: string) =>
    (await api(token).get('/automations/alerts').expect(200)).body.data
      .data as {
      type: string
      entityType: string | null
      entityId: string | null
    }[]

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
    await prisma.tenant.update({
      where: { id: tenantA.id },
      data: { email: 'info@a.com' },
    })
    await prisma.tenant.update({
      where: { id: tenantB.id },
      data: { defaultCurrency: 'USD' },
    })
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

    const location = async (tenantId: string, name: string) =>
      (await prisma.location.findFirstOrThrow({ where: { tenantId, name } })).id
    const type = async (tenantId: string, name: string) =>
      (
        await prisma.propertyType.findFirstOrThrow({
          where: { tenantId, name },
        })
      ).id
    refs = {
      tolosa: await location(tenantA.id, 'Tolosa'),
      city: await location(tenantA.id, 'La Plata'),
      casa: await type(tenantA.id, 'Casa'),
      depto: await type(tenantA.id, 'Departamento'),
    }
    refsB = {
      tolosa: await location(tenantB.id, 'Tolosa'),
      casa: await type(tenantB.id, 'Casa'),
    }
  })

  describe('campos de publicación de la propiedad (backoffice)', () => {
    it('guarda precio, moneda y descripción pública, y los devuelve en alta, ficha y listado', async () => {
      const created = await api(adminToken)
        .post('/properties')
        .send({
          address: 'Calle 7 1234',
          locationId: refs.tolosa,
          propertyTypeId: refs.casa,
          listingPrice: '150000',
          listingCurrency: 'USD',
          publicDescription: '  Luminosa, con patio  ',
        })
        .expect(201)

      expect(created.body.data).toMatchObject({
        listingPrice: '150000.00',
        listingCurrency: 'USD',
        publicDescription: 'Luminosa, con patio',
      })

      const detail = await api(adminToken)
        .get(`/properties/${created.body.data.id}`)
        .expect(200)
      expect(detail.body.data.listingPrice).toBe('150000.00')

      const list = await api(adminToken).get('/properties').expect(200)
      expect(list.body.data.data[0]).toMatchObject({
        listingPrice: '150000.00',
        listingCurrency: 'USD',
      })
    })

    it('sin precio es "Consultar" y la moneda es la de la inmobiliaria', async () => {
      const a = await createProperty({})
      const b = await createProperty({ address: 'Calle B' }, adminBToken, refsB)

      const detailA = await api(adminToken).get(`/properties/${a.id}`)
      const detailB = await api(adminBToken).get(`/properties/${b.id}`)

      expect(detailA.body.data).toMatchObject({
        listingPrice: null,
        listingCurrency: 'ARS',
        publicDescription: null,
      })
      expect(detailB.body.data.listingCurrency).toBe('USD')
    })

    it('se edita por PATCH y un precio vacío o cero vuelve a "Consultar"', async () => {
      const property = await createProperty({ listingPrice: '90000.5' })

      const edited = await api(adminToken)
        .patch(`/properties/${property.id}`)
        .send({ listingPrice: '120000', publicDescription: 'Nueva' })
        .expect(200)
      expect(edited.body.data).toMatchObject({
        listingPrice: '120000.00',
        publicDescription: 'Nueva',
      })

      const cleared = await api(adminToken)
        .patch(`/properties/${property.id}`)
        .send({ listingPrice: null, publicDescription: '' })
        .expect(200)
      expect(cleared.body.data).toMatchObject({
        listingPrice: null,
        publicDescription: null,
      })
    })

    it('rechaza un precio con formato inválido y una descripción de más de 2000 caracteres', async () => {
      const base = {
        address: 'Calle 9',
        locationId: refs.tolosa,
        propertyTypeId: refs.casa,
      }
      await api(adminToken)
        .post('/properties')
        .send({ ...base, listingPrice: '12,5' })
        .expect(400)
      await api(adminToken)
        .post('/properties')
        .send({ ...base, listingPrice: '-5' })
        .expect(400)
      await api(adminToken)
        .post('/properties')
        .send({ ...base, publicDescription: 'x'.repeat(2001) })
        .expect(400)
    })
  })

  describe('listado y ficha públicos', () => {
    it('no pide token y devuelve sólo propiedades disponibles, con el contrato del portal', async () => {
      const owner = await api(adminToken)
        .post('/owners')
        .send({ firstName: 'Juan', lastName: 'Pérez', nationalId: '30111222' })
        .expect(201)
      const visible = await createProperty({
        address: 'Av. Corrientes 1234, 5° B',
        listingPrice: '150000',
        publicDescription: 'Luminoso',
        ownerId: owner.body.data.id,
        notes: 'Llave en portería',
      })
      const rented = await createProperty({ address: 'Alquilada 1' })
      await setStatus(rented.id, 'RENTED')
      const maintenance = await createProperty({ address: 'Reparación 1' })
      await setStatus(maintenance.id, 'MAINTENANCE')

      const response = await pub.get('/public/tenant-a/properties').expect(200)

      expect(response.body.data.pagination.total).toBe(1)
      const [item] = response.body.data.data
      expect(item).toEqual({
        id: visible.id,
        title: 'Av. Corrientes 1234',
        address: 'Av. Corrientes 1234, 5° B',
        propertyType: 'Casa',
        neighborhood: 'Tolosa',
        bedrooms: null,
        bathrooms: null,
        areaM2: null,
        price: '150000.00',
        currency: 'ARS',
        coverPhotoUrl: null,
        amenities: [],
        // Campos aditivos del sitio web: una propiedad sin datos sale en alquiler.
        operation: 'RENT',
        rooms: null,
        coveredAreaM2: null,
        ageYears: null,
      })
      // Nada de propietario, contrato ni notas internas.
      const text = JSON.stringify(response.body)
      expect(text).not.toContain('Llave en portería')
      expect(text).not.toContain(owner.body.data.id)
      expect(text).not.toContain('ownerId')
      expect(text).not.toContain('activeContractId')
    })

    it('una propiedad no disponible no aparece ni en el listado ni en la ficha, y vuelve al estar disponible', async () => {
      const property = await createProperty({})
      await setStatus(property.id, 'MAINTENANCE')

      const list = await pub.get('/public/tenant-a/properties').expect(200)
      expect(list.body.data.data).toHaveLength(0)
      const hidden = await pub
        .get(`/public/tenant-a/properties/${property.id}`)
        .expect(404)
      expect(hidden.body.code).toBe('PROPERTY_NOT_AVAILABLE')

      await setStatus(property.id, 'AVAILABLE')
      const shown = await pub
        .get(`/public/tenant-a/properties/${property.id}`)
        .expect(200)
      expect(shown.body.data).toMatchObject({
        id: property.id,
        publicDescription: null,
        location: 'Tolosa, La Plata',
        photos: [],
        features: [
          { label: 'Tipo', value: 'Casa' },
          { label: 'Ubicación', value: 'Tolosa, La Plata' },
        ],
      })
    })

    it('una propiedad borrada o inexistente es el mismo 404', async () => {
      const property = await createProperty({})
      await api(adminToken).delete(`/properties/${property.id}`).expect(204)

      await pub.get(`/public/tenant-a/properties/${property.id}`).expect(404)
      await pub.get(`/public/tenant-a/properties/${UNKNOWN_ID}`).expect(404)
      await pub.get('/public/tenant-a/properties/no-es-un-uuid').expect(400)
    })

    it('filtra por ubicación, tipo y rango de precio con moneda', async () => {
      await createProperty({
        address: 'Barata ARS',
        listingPrice: '100000',
        listingCurrency: 'ARS',
      })
      await createProperty({
        address: 'Cara ARS',
        listingPrice: '500000',
        listingCurrency: 'ARS',
      })
      await createProperty({
        address: 'Depto USD',
        listingPrice: '300',
        listingCurrency: 'USD',
        propertyTypeId: refs.depto,
        locationId: refs.city,
      })
      await createProperty({ address: 'Sin precio' })

      const titles = async (query: string) =>
        (
          await pub.get(`/public/tenant-a/properties?${query}`).expect(200)
        ).body.data.data
          .map((p: { title: string }) => p.title)
          .sort()

      expect(await titles('')).toHaveLength(4)
      expect(await titles(`propertyTypeId=${refs.depto}`)).toEqual([
        'Depto USD',
      ])
      expect(await titles(`locationId=${refs.city}`)).toEqual(['Depto USD'])
      // Sin moneda, el rango usa la de la inmobiliaria (ARS) y deja afuera "Consultar".
      expect(await titles('priceFrom=50000&priceTo=200000')).toEqual([
        'Barata ARS',
      ])
      expect(await titles('priceFrom=200000')).toEqual(['Cara ARS'])
      expect(await titles('priceFrom=100&currency=USD')).toEqual(['Depto USD'])
      expect(await titles('currency=USD')).toEqual(['Depto USD'])
    })

    it('pagina, más nuevas primero', async () => {
      for (const n of [1, 2, 3]) await createProperty({ address: `Calle ${n}` })

      const first = await pub
        .get('/public/tenant-a/properties?page=1&limit=2')
        .expect(200)
      const second = await pub
        .get('/public/tenant-a/properties?page=2&limit=2')
        .expect(200)

      expect(
        first.body.data.data.map((p: { title: string }) => p.title),
      ).toEqual(['Calle 3', 'Calle 2'])
      expect(
        second.body.data.data.map((p: { title: string }) => p.title),
      ).toEqual(['Calle 1'])
      expect(first.body.data.pagination).toMatchObject({
        total: 3,
        totalPages: 2,
        hasNextPage: true,
      })
    })

    describe('orden (sort)', () => {
      const titles = async (query: string) =>
        (
          (await pub.get(`/public/tenant-a/properties?${query}`).expect(200))
            .body.data.data as { title: string }[]
        ).map((p) => p.title)

      const seed = async () => {
        await createProperty({ address: 'Sin precio 1' })
        await createProperty({ address: 'Media', listingPrice: '200000' })
        await createProperty({ address: 'Cara', listingPrice: '900000' })
        await createProperty({ address: 'Barata', listingPrice: '50000' })
        await createProperty({ address: 'Sin precio 2' })
      }

      it('sin sort es recent: más nuevas primero', async () => {
        await seed()
        const recent = await titles('')
        expect(recent).toEqual([
          'Sin precio 2',
          'Barata',
          'Cara',
          'Media',
          'Sin precio 1',
        ])
        expect(await titles('sort=recent')).toEqual(recent)
      })

      it('price_asc y price_desc ordenan por monto y dejan las sin precio al final', async () => {
        await seed()
        // Entre las sin precio manda createdAt desc y después id: determinista.
        expect(await titles('sort=price_asc')).toEqual([
          'Barata',
          'Media',
          'Cara',
          'Sin precio 2',
          'Sin precio 1',
        ])
        expect(await titles('sort=price_desc')).toEqual([
          'Cara',
          'Media',
          'Barata',
          'Sin precio 2',
          'Sin precio 1',
        ])
      })

      it('compara montos como Decimal, no como texto ni float', async () => {
        await createProperty({ address: 'Nueve', listingPrice: '9' })
        await createProperty({ address: 'Diez', listingPrice: '10' })
        await createProperty({ address: 'Centavos', listingPrice: '9.99' })
        expect(await titles('sort=price_asc')).toEqual([
          'Nueve',
          'Centavos',
          'Diez',
        ])
      })

      it('pagina sin repetir ni omitir filas, incluso con precios iguales', async () => {
        for (const n of [1, 2, 3, 4, 5]) {
          await createProperty({ address: `Igual ${n}`, listingPrice: '1000' })
        }
        await createProperty({ address: 'Sin precio' })
        for (const sort of ['price_asc', 'price_desc']) {
          const seen: string[] = []
          for (const page of [1, 2, 3]) {
            seen.push(...(await titles(`sort=${sort}&page=${page}&limit=2`)))
          }
          expect(new Set(seen).size).toBe(6)
          expect(seen[5]).toBe('Sin precio')
        }
      })

      it('se combina con los filtros y rechaza valores inválidos', async () => {
        await seed()
        expect(
          await titles('sort=price_desc&priceFrom=100000&currency=ARS'),
        ).toEqual(['Cara', 'Media'])
        await pub.get('/public/tenant-a/properties?sort=price').expect(400)
        await pub.get('/public/tenant-a/properties?sort=PRICE_ASC').expect(400)
        await pub.get('/public/tenant-a/properties?sort=').expect(400)
      })
    })

    it('rechaza filtros mal formados', async () => {
      await pub.get('/public/tenant-a/properties?priceFrom=abc').expect(400)
      await pub.get('/public/tenant-a/properties?currency=EUR').expect(400)
      await pub.get('/public/tenant-a/properties?locationId=nope').expect(400)
    })

    it('/filters trae sólo tipos y ubicaciones en uso por propiedades disponibles', async () => {
      await createProperty({})
      const maintenance = await createProperty({
        propertyTypeId: refs.depto,
        locationId: refs.city,
      })
      await setStatus(maintenance.id, 'MAINTENANCE')

      const response = await pub.get('/public/tenant-a/filters').expect(200)

      expect(response.body.data).toEqual({
        propertyTypes: [{ id: refs.casa, name: 'Casa' }],
        locations: [{ id: refs.tolosa, name: 'Tolosa, La Plata' }],
      })
    })
  })

  describe('aislamiento entre inmobiliarias', () => {
    it('cada slug ve sólo lo suyo, y la ficha de otra inmobiliaria es un 404', async () => {
      const a = await createProperty({ address: 'Calle de A' })
      const b = await createProperty(
        { address: 'Calle de B' },
        adminBToken,
        refsB,
      )

      const listA = await pub.get('/public/tenant-a/properties').expect(200)
      const listB = await pub.get('/public/tenant-b/properties').expect(200)
      expect(listA.body.data.data.map((p: { id: string }) => p.id)).toEqual([
        a.id,
      ])
      expect(listB.body.data.data.map((p: { id: string }) => p.id)).toEqual([
        b.id,
      ])

      await pub.get(`/public/tenant-a/properties/${b.id}`).expect(404)
      await pub.get(`/public/tenant-b/properties/${a.id}`).expect(404)

      const filtersB = await pub.get('/public/tenant-b/filters').expect(200)
      expect(filtersB.body.data.locations).toEqual([
        { id: refsB.tolosa, name: 'Tolosa, La Plata' },
      ])
    })

    it('un slug inexistente o de una inmobiliaria deshabilitada es un 404', async () => {
      await createProperty({})

      const unknown = await pub.get('/public/nadie/properties').expect(404)
      expect(unknown.body.code).toBe('TENANT_NOT_FOUND')
      await pub.get('/public/nadie/filters').expect(404)
      await contact('nadie').expect(404)

      await prisma.tenant.update({
        where: { id: tenantA.id },
        data: { isActive: false },
      })
      await pub.get('/public/tenant-a/properties').expect(404)
      await contact('tenant-a').expect(404)
    })
  })

  describe('contacto', () => {
    it('guarda la consulta (201), avisa al personal y no la muestra a otra inmobiliaria', async () => {
      const property = await createProperty({ address: 'Calle 7 1234' })

      const response = await contact('tenant-a', {
        name: '  Ana   Pérez ',
        email: 'ANA@Mail.com',
        propertyId: property.id,
      }).expect(201)
      const id = response.body.data.id as string
      expect(id).toEqual(expect.any(String))

      const row = await prisma.publicInquiry.findUniqueOrThrow({
        where: { id },
      })
      expect(row).toMatchObject({
        tenantId: tenantA.id,
        name: 'Ana Pérez',
        email: 'ana@mail.com',
        propertyId: property.id,
        status: 'NEW',
        source: 'PORTAL',
      })
      expect(row.ip).toEqual(expect.any(String))

      // Aviso interno (campana), sólo de la inmobiliaria que recibió la consulta.
      await waitFor(async () =>
        (await alertsOf(adminToken)).some((a) => a.type === 'PUBLIC_INQUIRY'),
      )
      const alert = (await alertsOf(employeeToken)).find(
        (a) => a.type === 'PUBLIC_INQUIRY',
      )
      expect(alert).toMatchObject({
        entityType: 'PublicInquiry',
        entityId: id,
      })
      expect(
        (await alertsOf(adminBToken)).some((a) => a.type === 'PUBLIC_INQUIRY'),
      ).toBe(false)

      const list = await api(adminToken).get('/inquiries').expect(200)
      expect(list.body.data.data).toEqual([
        expect.objectContaining({
          id,
          name: 'Ana Pérez',
          email: 'ana@mail.com',
          property: { id: property.id, address: 'Calle 7 1234' },
          status: 'NEW',
          source: 'PORTAL',
        }),
      ])
      // La IP es sólo para frenar spam: nunca sale por la API.
      expect(JSON.stringify(list.body)).not.toContain('"ip"')

      const listB = await api(adminBToken).get('/inquiries').expect(200)
      expect(listB.body.data.data).toHaveLength(0)
    })

    it('el teléfono es opcional y propertyId puede ir null', async () => {
      await contact('tenant-a', { phone: undefined }).expect(201)
      await contact('tenant-a', { phone: '', email: 'otra@mail.com' }).expect(
        201,
      )
      expect(await prisma.publicInquiry.count()).toBe(2)
    })

    it('honeypot: con el campo trampa lleno responde 201 pero no guarda ni avisa', async () => {
      const response = await contact('tenant-a', {
        website: 'http://spam.example',
      }).expect(201)

      expect(response.body.data.id).toEqual(expect.any(String))
      expect(await prisma.publicInquiry.count()).toBe(0)
      // Un bot no cuenta para el límite de los que sí escriben.
      for (let i = 0; i < 5; i += 1) {
        await contact('tenant-a', {
          website: 'x',
          email: `bot${i}@x.com`,
        }).expect(201)
      }
      await contact('tenant-a').expect(201)
    })

    it('rate limit: la 6ta consulta en una hora desde la misma IP es un 429', async () => {
      for (let i = 0; i < 5; i += 1) {
        await contact('tenant-a', { email: `persona${i}@mail.com` }).expect(201)
      }

      const blocked = await contact('tenant-a', {
        email: 'persona9@mail.com',
      }).expect(429)
      expect(blocked.body.code).toBe('RATE_LIMIT_EXCEEDED')
      expect(await prisma.publicInquiry.count()).toBe(5)

      // El tope es por inmobiliaria: la misma IP puede consultar en otra.
      await contact('tenant-b', { email: 'persona9@mail.com' }).expect(201)
    })

    it('rate limit por email: no cuenta las consultas viejas (fuera de la ventana)', async () => {
      for (let i = 0; i < 5; i += 1) {
        await contact('tenant-a').expect(201)
      }
      await contact('tenant-a').expect(429)

      await prisma.publicInquiry.updateMany({
        data: { createdAt: new Date(Date.now() - 2 * 3_600_000) },
      })

      await contact('tenant-a').expect(201)
    })

    it('una propiedad que ya no está disponible es un 409 PROPERTY_NOT_AVAILABLE', async () => {
      const property = await createProperty({})
      await setStatus(property.id, 'RENTED')

      const rented = await contact('tenant-a', {
        propertyId: property.id,
      }).expect(409)
      expect(rented.body.code).toBe('PROPERTY_NOT_AVAILABLE')

      await contact('tenant-a', { propertyId: UNKNOWN_ID }).expect(409)

      // Una propiedad disponible de otra inmobiliaria tampoco vale.
      const other = await createProperty({}, adminBToken, refsB)
      await contact('tenant-a', { propertyId: other.id }).expect(409)
      expect(await prisma.publicInquiry.count()).toBe(0)
    })

    it('valida los datos: nombre, email y mensaje obligatorios, y largos máximos', async () => {
      await contact('tenant-a', { name: '' }).expect(400)
      await contact('tenant-a', { email: 'no-es-un-email' }).expect(400)
      await contact('tenant-a', { message: '   ' }).expect(400)
      await contact('tenant-a', { message: 'x'.repeat(2001) }).expect(400)
      await contact('tenant-a', { propertyId: 'nope' }).expect(400)
      expect(await prisma.publicInquiry.count()).toBe(0)
    })
  })

  describe('consultas para el personal', () => {
    const inquiryOf = async (tenantId: string, name = 'Ana') =>
      prisma.publicInquiry.create({
        data: {
          tenantId,
          name,
          email: `${name.toLowerCase()}@mail.com`,
          phone: '',
          message: 'Hola',
        },
      })

    it('requiere sesión del personal', async () => {
      await request(app.getHttpServer()).get('/api/v1/inquiries').expect(401)
      await request(app.getHttpServer())
        .patch(`/api/v1/inquiries/${UNKNOWN_ID}/status`)
        .send({ status: 'CLOSED' })
        .expect(401)
    })

    it('lista con filtro por estado y cambia el estado (admin y empleado)', async () => {
      const one = await inquiryOf(tenantA.id, 'Ana')
      await inquiryOf(tenantA.id, 'Beto')

      const changed = await api(employeeToken)
        .patch(`/inquiries/${one.id}/status`)
        .send({ status: 'CONTACTED' })
        .expect(200)
      expect(changed.body.data).toMatchObject({
        id: one.id,
        status: 'CONTACTED',
      })

      const contacted = await api(adminToken)
        .get('/inquiries?status=CONTACTED')
        .expect(200)
      expect(contacted.body.data.data.map((i: { id: string }) => i.id)).toEqual(
        [one.id],
      )
      const fresh = await api(adminToken)
        .get('/inquiries?status=NEW')
        .expect(200)
      expect(fresh.body.data.pagination.total).toBe(1)

      await api(adminToken)
        .patch(`/inquiries/${one.id}/status`)
        .send({ status: 'NOPE' })
        .expect(400)
    })

    it('otra inmobiliaria no ve ni modifica la consulta (404)', async () => {
      const mine = await inquiryOf(tenantA.id)

      await api(adminBToken)
        .patch(`/inquiries/${mine.id}/status`)
        .send({ status: 'CLOSED' })
        .expect(404)
      expect(
        (
          await prisma.publicInquiry.findUniqueOrThrow({
            where: { id: mine.id },
          })
        ).status,
      ).toBe('NEW')
    })
  })

  describe('datos de la ficha para el sitio web', () => {
    it('se cargan en el alta y la edición, y salen en la API pública sin romper su forma', async () => {
      const created = await createProperty({
        listingOperation: 'SALE',
        listingPrice: '120000',
        listingCurrency: 'USD',
        bedrooms: 3,
        bathrooms: 2,
        rooms: 4,
        totalAreaM2: 85.5,
        coveredAreaM2: 70,
        ageYears: 12,
      })
      const bare = await createProperty({ address: 'Sin datos 1' })

      const detail = await pub
        .get(`/public/tenant-a/properties/${created.id}`)
        .expect(200)
      expect(detail.body.data).toMatchObject({
        bedrooms: 3,
        bathrooms: 2,
        areaM2: 85.5,
        operation: 'SALE',
        rooms: 4,
        coveredAreaM2: 70,
        ageYears: 12,
      })
      expect(JSON.stringify(detail.body)).not.toContain('latitude')

      // Una propiedad vieja (sin datos) se publica en alquiler y con null.
      const old = await pub
        .get(`/public/tenant-a/properties/${bare.id}`)
        .expect(200)
      expect(old.body.data).toMatchObject({
        bedrooms: null,
        areaM2: null,
        operation: 'RENT',
      })

      await api(adminToken)
        .patch(`/properties/${bare.id}`)
        .send({ bedrooms: 1, listingOperation: 'SALE' })
        .expect(200)
      const edited = await api(adminToken)
        .get(`/properties/${bare.id}`)
        .expect(200)
      expect(edited.body.data).toMatchObject({
        bedrooms: 1,
        listingOperation: 'SALE',
        totalAreaM2: null,
      })
    })

    it('filtra por operación, dormitorios, baños e ids', async () => {
      const sale = await createProperty({
        listingOperation: 'SALE',
        bedrooms: 3,
        bathrooms: 2,
      })
      const rent = await createProperty({ bedrooms: 1, bathrooms: 1 })

      const ids = async (query: string) =>
        (
          (await pub.get(`/public/tenant-a/properties?${query}`).expect(200))
            .body.data.data as { id: string }[]
        ).map((p) => p.id)

      expect(await ids('operation=SALE')).toEqual([sale.id])
      expect(await ids('operation=RENT')).toEqual([rent.id])
      expect(await ids('bedrooms=2')).toEqual([sale.id])
      expect(await ids('bathrooms=1')).toHaveLength(2)
      expect(await ids(`ids=${rent.id}`)).toEqual([rent.id])

      await setStatus(rent.id, 'MAINTENANCE')
      expect(await ids(`ids=${rent.id}`)).toEqual([])
    })

    it('rechaza valores fuera de rango', async () => {
      await api(adminToken)
        .post('/properties')
        .send({
          address: 'X 1',
          locationId: refs.tolosa,
          propertyTypeId: refs.casa,
          bedrooms: -1,
          latitude: 120,
        })
        .expect(400)
      await pub.get('/public/tenant-a/properties?operation=NOPE').expect(400)
      await pub.get('/public/tenant-a/properties?bedrooms=abc').expect(400)
    })
  })

  describe('rate limiting de las lecturas', () => {
    let throttled: INestApplication
    const original = process.env.THROTTLE_ENABLED

    beforeAll(async () => {
      process.env.THROTTLE_ENABLED = 'true'
      throttled = await createTestApp()
    })

    afterAll(async () => {
      await throttled.close()
      process.env.THROTTLE_ENABLED = original
    })

    it('el servidor de sitios (con el secreto compartido) no cuenta contra el tope de las lecturas', async () => {
      let blocked = 0
      for (let i = 0; i < 80; i += 1) {
        const response = await request(throttled.getHttpServer())
          .get('/api/v1/public/tenant-a/filters')
          .set('X-Sites-Secret', 'secreto-compartido-e2e')
        if (response.status === 429) blocked += 1
      }
      expect(blocked).toBe(0)
    })

    it('frena a una IP que pide demasiado y avisa con Retry-After', async () => {
      const statuses: number[] = []
      let blocked: request.Response | undefined
      for (let i = 0; i < 80 && !blocked; i += 1) {
        const response = await request(throttled.getHttpServer()).get(
          '/api/v1/public/tenant-a/filters',
        )
        statuses.push(response.status)
        if (response.status === 429) blocked = response
      }

      expect(statuses[0]).toBe(200)
      expect(blocked?.body.code).toBe('RATE_LIMIT_EXCEEDED')
      expect(blocked?.headers['retry-after']).toBeDefined()
    })
  })
})
