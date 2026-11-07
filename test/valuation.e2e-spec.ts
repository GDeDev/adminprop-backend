import { INestApplication } from '@nestjs/common'
import { MarketCategory, MarketSource, Role } from '@prisma/client'
import request from 'supertest'

import { seedBaseMasterData } from '../prisma/lib/master-data-seed'
import { JobScheduler } from '../src/modules/automations/application/job-scheduler'
import {
  findJobDefinition,
  JobTrigger,
} from '../src/modules/automations/domain/job-catalog'
import { ComparablesRefreshService } from '../src/modules/valuation/application/comparables-refresh.service'
import { localMoment } from '../src/shared/dates/zoned-time'
import {
  ComparableSourcePort,
  ComparableSourceRegistry,
  SourceBlockedError,
  SourceParseError,
  SourcePage,
} from '../src/modules/valuation/domain/valuation.ports'
import { FakeComparableSource } from '../src/modules/valuation/infrastructure/sources/fake.source'
import { ValuationFacade } from '../src/modules/valuation/public'
import { MarketSource as Source } from '../src/modules/valuation/domain/market'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginAs, loginToPortalAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'
import { waitFor } from './utils/wait-for'

// El límite diario se lee al arrancar la app: bajo, para probarlo sin 30 pedidos.
process.env.VALUATION_DAILY_LIMIT = '4'

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'
const DAY_MS = 86_400_000
const TOLOSA = 'buenos-aires/la-plata/tolosa'
const LA_PLATA = 'buenos-aires/la-plata'

/** Una fuente extra que se porta como el test le pide. */
class ScriptedSource extends ComparableSourcePort {
  calls = 0
  constructor(
    readonly source: Source,
    private behaviour: 'blocked' | 'parse' | 'empty',
  ) {
    super()
  }
  async search(): Promise<SourcePage> {
    this.calls += 1
    if (this.behaviour === 'blocked') {
      throw new SourceBlockedError(this.source, 'HTTP 403')
    }
    if (this.behaviour === 'parse') {
      throw new SourceParseError(this.source, 'cambió la estructura')
    }
    return { items: [], hasMore: false }
  }
}

/** Tasación automática (Fase 24): contrato, reglas, aislamiento, permisos y job global. */
describe('Tasación automática (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string }
  let tenantB: { id: string }
  let adminToken: string
  let employeeToken: string
  let adminBToken: string
  let refsA: { tolosa: string; palermo: string; casa: string; depto: string }
  let refsB: { tolosa: string; casa: string }
  let registry: ComparableSourcePort[]
  let fake: FakeComparableSource

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

  const createProperty = async (
    token: string,
    location: string,
    type: string,
    extra: Record<string, unknown> = {},
  ) =>
    (
      await api(token)
        .post('/properties')
        .send({
          address: `Calle ${Math.random().toString(36).slice(2, 8)} 123`,
          locationId: location,
          propertyTypeId: type,
          ...extra,
        })
        .expect(201)
    ).body.data.id as string

  /** Avisos de mercado directo en la base (es el caché global, no una tasación). */
  const seedComparables = async (
    zoneKey: string,
    prices: string[],
    options: {
      category?: MarketCategory
      currency?: 'ARS' | 'USD'
      daysAgo?: number
      area?: string
    } = {},
  ) => {
    const lastSeenAt = new Date(Date.now() - (options.daysAgo ?? 1) * DAY_MS)
    await prisma.marketComparable.createMany({
      data: prices.map((price, index) => ({
        source: MarketSource.FAKE,
        externalId: `${zoneKey}-${options.category ?? 'HOUSE'}-${options.currency ?? 'ARS'}-${lastSeenAt.getTime()}-${index}`,
        zoneKey,
        category: options.category ?? MarketCategory.HOUSE,
        price,
        currency: options.currency ?? 'ARS',
        areaM2: options.area ?? null,
        url: 'https://fake.invalid/x',
        lastSeenAt,
      })),
    })
  }

  const SIX = ['100000', '110000', '120000', '130000', '140000', '150000']

  beforeAll(async () => {
    await prisma.$connect()
    app = await createTestApp()
    registry = app.get(ComparableSourceRegistry).list()
    fake = registry[0] as FakeComparableSource
  })

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    registry.splice(1)
    fake.reset()
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
      palermo: (
        await prisma.location.findFirstOrThrow({
          where: { tenantId, name: 'Palermo' },
        })
      ).id,
      casa: (
        await prisma.propertyType.findFirstOrThrow({
          where: { tenantId, name: 'Casa' },
        })
      ).id,
      depto: (
        await prisma.propertyType.findFirstOrThrow({
          where: { tenantId, name: 'Departamento' },
        })
      ).id,
    })
    refsA = await master(tenantA.id)
    refsB = await master(tenantB.id)
  })

  describe('tasar', () => {
    it('devuelve el rango, la confianza y la justificación con el contrato de valuation.ts', async () => {
      await seedComparables(TOLOSA, SIX)
      const propertyId = await createProperty(
        adminToken,
        refsA.tolosa,
        refsA.casa,
      )

      const res = await api(adminToken)
        .post(`/valuation/properties/${propertyId}/appraise`)
        .send({})
        .expect(201)

      expect(res.body.data).toMatchObject({
        propertyId,
        currency: 'ARS',
        minPrice: '110000.00',
        maxPrice: '140000.00',
        suggestedPrice: '125000.00',
        suggestedPriceRounded: '125000.00',
        confidence: 'MEDIUM',
        comparablesUsed: 6,
        comparablesDiscarded: 0,
        zoneLabel: 'Tolosa, La Plata',
        zoneWidened: false,
        engine: 'STATISTICAL',
        reused: false,
        requestedBy: { fullName: 'admin@a.com' },
      })
      expect(res.body.data.justification).toContain('6 avisos de alquiler')
      expect(typeof res.body.data.oldestComparableAt).toBe('string')
      expect(typeof res.body.data.createdAt).toBe('string')
    })

    it('el precio de la propiedad no cambia: es una sugerencia', async () => {
      await seedComparables(TOLOSA, SIX)
      const propertyId = await createProperty(
        adminToken,
        refsA.tolosa,
        refsA.casa,
        { listingPrice: '99999.00', listingCurrency: 'ARS' },
      )

      await api(adminToken)
        .post(`/valuation/properties/${propertyId}/appraise`)
        .send({})
        .expect(201)

      const row = await prisma.property.findUniqueOrThrow({
        where: { id: propertyId },
      })
      expect(row.listingPrice?.toFixed(2)).toBe('99999.00')
    })

    it('descarta atípicos y los informa', async () => {
      await seedComparables(TOLOSA, [...SIX, '900000', '1000'])
      const propertyId = await createProperty(
        adminToken,
        refsA.tolosa,
        refsA.casa,
      )

      const res = await api(adminToken)
        .post(`/valuation/properties/${propertyId}/appraise`)
        .send({})
        .expect(201)

      expect(res.body.data.comparablesUsed).toBe(6)
      expect(res.body.data.comparablesDiscarded).toBe(2)
      expect(res.body.data.justification).toContain('2 descartados')
    })

    it('por m²: lleva los avisos al tamaño de la propiedad', async () => {
      // 2.000 por m² en todos: con 50 m² son 100.000.
      await seedComparables(TOLOSA, ['80000', '100000', '120000'], {
        area: '40',
      })
      await prisma.marketComparable.updateMany({
        where: { price: 100000 },
        data: { areaM2: 50 },
      })
      await prisma.marketComparable.updateMany({
        where: { price: 120000 },
        data: { areaM2: 60 },
      })
      const propertyId = await createProperty(
        adminToken,
        refsA.tolosa,
        refsA.casa,
      )

      const res = await api(adminToken)
        .post(`/valuation/properties/${propertyId}/appraise`)
        .send({ areaM2: '50' })
        .expect(201)

      expect(res.body.data.suggestedPrice).toBe('100000.00')
      expect(res.body.data.justification).toContain('por m²')
    })

    it('sin superficie tasa por precio absoluto y lo avisa', async () => {
      await seedComparables(TOLOSA, SIX)
      const propertyId = await createProperty(
        adminToken,
        refsA.tolosa,
        refsA.casa,
      )
      const res = await api(adminToken)
        .post(`/valuation/properties/${propertyId}/appraise`)
        .send({})
        .expect(201)
      expect(res.body.data.justification).toContain('no tiene superficie')
    })

    it('no mezcla monedas ni categorías', async () => {
      await seedComparables(TOLOSA, SIX, { currency: 'USD' })
      await seedComparables(TOLOSA, SIX, {
        category: MarketCategory.APARTMENT,
      })
      const propertyId = await createProperty(
        adminToken,
        refsA.tolosa,
        refsA.casa,
      )

      const res = await api(adminToken)
        .post(`/valuation/properties/${propertyId}/appraise`)
        .send({})
        .expect(422)
      expect(res.body.code).toBe('INSUFFICIENT_MARKET_DATA')

      // En dólares sí hay datos.
      await api(adminToken)
        .post(`/valuation/properties/${propertyId}/appraise`)
        .send({ currency: 'USD' })
        .expect(201)
    })

    it('422 INSUFFICIENT_MARKET_DATA con menos de 3 avisos, y deja la zona registrada para el próximo refresco', async () => {
      await seedComparables(TOLOSA, ['100000', '110000'])
      const propertyId = await createProperty(
        adminToken,
        refsA.tolosa,
        refsA.casa,
      )

      const res = await api(adminToken)
        .post(`/valuation/properties/${propertyId}/appraise`)
        .send({})
        .expect(422)

      expect(res.body.code).toBe('INSUFFICIENT_MARKET_DATA')
      expect(res.body.message).toBe(
        'No hay suficientes datos de mercado para esta zona todavía',
      )
      const zone = await prisma.valuationZone.findFirstOrThrow({
        where: { zoneKey: TOLOSA, category: 'HOUSE' },
      })
      expect(zone.requestedCount).toBe(1)
    })

    it('ignora los avisos más viejos que la antigüedad máxima (45 días)', async () => {
      await seedComparables(TOLOSA, SIX, { daysAgo: 60 })
      const propertyId = await createProperty(
        adminToken,
        refsA.tolosa,
        refsA.casa,
      )
      await api(adminToken)
        .post(`/valuation/properties/${propertyId}/appraise`)
        .send({})
        .expect(422)
    })

    it('amplía una vez a la zona padre, avisa y baja la confianza', async () => {
      await seedComparables(`${LA_PLATA}/centro`, SIX)
      const propertyId = await createProperty(
        adminToken,
        refsA.tolosa,
        refsA.casa,
      )

      const res = await api(adminToken)
        .post(`/valuation/properties/${propertyId}/appraise`)
        .send({})
        .expect(201)

      expect(res.body.data).toMatchObject({
        zoneWidened: true,
        zoneLabel: 'La Plata, Buenos Aires',
        confidence: 'LOW',
        comparablesUsed: 6,
      })
      expect(res.body.data.justification).toContain('se amplió la búsqueda')
    })

    it('una tasación idéntica dentro de 6 horas se reutiliza y no cuenta contra el límite', async () => {
      await seedComparables(TOLOSA, SIX)
      const propertyId = await createProperty(
        adminToken,
        refsA.tolosa,
        refsA.casa,
      )
      const first = await api(adminToken)
        .post(`/valuation/properties/${propertyId}/appraise`)
        .send({})
        .expect(201)
      const second = await api(adminToken)
        .post(`/valuation/properties/${propertyId}/appraise`)
        .send({})
        .expect(201)

      expect(second.body.data.reused).toBe(true)
      expect(second.body.data.id).toBe(first.body.data.id)
      expect(await prisma.valuationRequest.count()).toBe(1)

      const history = await api(adminToken)
        .get(`/valuation/properties/${propertyId}/history`)
        .expect(200)
      expect(history.body.data.data).toHaveLength(1)
      expect(history.body.data.data[0].reused).toBe(false)
    })

    it('429 VALUATION_DAILY_LIMIT al superar el límite diario de la inmobiliaria', async () => {
      await seedComparables(TOLOSA, SIX)
      const propertyId = await createProperty(
        adminToken,
        refsA.tolosa,
        refsA.casa,
      )
      for (const bedrooms of [1, 2, 3, 4]) {
        await api(adminToken)
          .post(`/valuation/properties/${propertyId}/appraise`)
          .send({ bedrooms })
          .expect(201)
      }

      const res = await api(adminToken)
        .post(`/valuation/properties/${propertyId}/appraise`)
        .send({ bedrooms: 5 })
        .expect(429)
      expect(res.body.code).toBe('VALUATION_DAILY_LIMIT')

      // Repetir una idéntica sigue andando: no cuenta.
      await api(adminToken)
        .post(`/valuation/properties/${propertyId}/appraise`)
        .send({ bedrooms: 4 })
        .expect(201)

      // El límite es por inmobiliaria: la otra no se entera.
      await seedComparables(TOLOSA, ['1'], { category: 'HOUSE' })
      const other = await createProperty(adminBToken, refsB.tolosa, refsB.casa)
      await api(adminBToken)
        .post(`/valuation/properties/${other}/appraise`)
        .send({})
        .expect(201)
    })

    it('el historial lista las más nuevas primero, con paginación', async () => {
      await seedComparables(TOLOSA, SIX)
      const propertyId = await createProperty(
        adminToken,
        refsA.tolosa,
        refsA.casa,
      )
      for (const bedrooms of [1, 2, 3]) {
        await api(employeeToken)
          .post(`/valuation/properties/${propertyId}/appraise`)
          .send({ bedrooms })
          .expect(201)
      }

      const page1 = await api(adminToken)
        .get(`/valuation/properties/${propertyId}/history?page=1&limit=2`)
        .expect(200)
      expect(page1.body.data.data).toHaveLength(2)
      expect(page1.body.data.pagination).toMatchObject({
        total: 3,
        totalPages: 2,
      })
      const dates = page1.body.data.data.map((r: any) => r.createdAt)
      expect(dates[0] >= dates[1]).toBe(true)
      expect(page1.body.data.data[0].requestedBy.fullName).toBe('emp@a.com')
    })

    it('valida el cuerpo', async () => {
      const propertyId = await createProperty(
        adminToken,
        refsA.tolosa,
        refsA.casa,
      )
      for (const body of [
        { areaM2: '-5' },
        { areaM2: 'abc' },
        { bedrooms: 1.5 },
        { currency: 'EUR' },
        { amenities: 'balcon' },
      ]) {
        await api(adminToken)
          .post(`/valuation/properties/${propertyId}/appraise`)
          .send(body)
          .expect(400)
      }
    })
  })

  describe('aislamiento entre inmobiliarias', () => {
    it('comparten los avisos de mercado pero no las tasaciones', async () => {
      await seedComparables(TOLOSA, SIX)
      const propA = await createProperty(adminToken, refsA.tolosa, refsA.casa)
      const propB = await createProperty(adminBToken, refsB.tolosa, refsB.casa)

      // B tasa sin haber scrapeado nada propio: usa el mismo caché global.
      const b = await api(adminBToken)
        .post(`/valuation/properties/${propB}/appraise`)
        .send({})
        .expect(201)
      expect(b.body.data.suggestedPrice).toBe('125000.00')
      await api(adminToken)
        .post(`/valuation/properties/${propA}/appraise`)
        .send({})
        .expect(201)

      expect(
        (
          await api(adminBToken)
            .get(`/valuation/properties/${propB}/history`)
            .expect(200)
        ).body.data.data,
      ).toHaveLength(1)
      expect(
        await prisma.valuationRequest.count({
          where: { tenantId: tenantA.id },
        }),
      ).toBe(1)
    })

    it('la propiedad de otra inmobiliaria es un 404 al tasar y al ver el historial', async () => {
      await seedComparables(TOLOSA, SIX)
      const propB = await createProperty(adminBToken, refsB.tolosa, refsB.casa)

      await api(adminToken)
        .post(`/valuation/properties/${propB}/appraise`)
        .send({})
        .expect(404)
      await api(adminToken)
        .get(`/valuation/properties/${propB}/history`)
        .expect(404)
      await api(adminToken)
        .post(`/valuation/properties/${UNKNOWN_ID}/appraise`)
        .send({})
        .expect(404)
    })

    it('la ubicación de otra inmobiliaria no existe para market-coverage', async () => {
      await api(adminToken)
        .get(`/valuation/market-coverage?locationId=${refsB.tolosa}`)
        .expect(404)
    })
  })

  describe('permisos', () => {
    it('propietarios e inquilinos reciben 403 en cada ruta de /valuation', async () => {
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
      const propertyId = await createProperty(
        adminToken,
        refsA.tolosa,
        refsA.casa,
      )

      for (const token of [owner, renter]) {
        await api(token)
          .post(`/valuation/properties/${propertyId}/appraise`)
          .send({})
          .expect(403)
        await api(token)
          .get(`/valuation/properties/${propertyId}/history`)
          .expect(403)
        await api(token).get('/valuation/market-status').expect(403)
        await api(token)
          .get(`/valuation/market-coverage?locationId=${refsA.tolosa}`)
          .expect(403)
        await api(token)
          .post('/valuation/zones/refresh')
          .send({ locationId: refsA.tolosa })
          .expect(403)
      }
    })

    it('sin sesión es 401 y el empleado no puede refrescar zonas', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/valuation/market-status')
        .expect(401)
      await api(employeeToken)
        .post('/valuation/zones/refresh')
        .send({ locationId: refsA.tolosa })
        .expect(403)
      await api(employeeToken).get('/valuation/market-status').expect(200)
    })
  })

  describe('cobertura y estado del mercado', () => {
    it('market-coverage anticipa si hay datos suficientes', async () => {
      const before = await api(adminToken)
        .get(`/valuation/market-coverage?locationId=${refsA.tolosa}`)
        .expect(200)
      expect(before.body.data).toEqual({
        zoneLabel: 'Tolosa, La Plata',
        activeComparables: 0,
        enoughData: false,
        lastRefreshedAt: null,
      })

      await seedComparables(TOLOSA, SIX)
      const after = await api(adminToken)
        .get(`/valuation/market-coverage?locationId=${refsA.tolosa}`)
        .expect(200)
      expect(after.body.data).toMatchObject({
        activeComparables: 6,
        enoughData: true,
      })

      await api(adminToken)
        .get('/valuation/market-coverage?locationId=nope')
        .expect(400)
      await api(adminToken)
        .get(`/valuation/market-coverage?locationId=${UNKNOWN_ID}`)
        .expect(404)
    })

    it('market-status muestra cada fuente: las no activadas, DISABLED', async () => {
      const res = await api(adminToken)
        .get('/valuation/market-status')
        .expect(200)

      expect(res.body.data.maxAgeDays).toBe(45)
      const bySource = Object.fromEntries(
        res.body.data.sources.map((s: any) => [s.source, s]),
      )
      expect(bySource.ZONAPROP).toMatchObject({ status: 'DISABLED' })
      expect(bySource.ARGENPROP.status).toBe('DISABLED')
      expect(bySource.MERCADOLIBRE.status).toBe('DISABLED')
      expect(bySource.FAKE).toMatchObject({
        status: 'STALE',
        lastIngestAt: null,
        activeComparables: 0,
      })
    })
  })

  describe('refresco de comparables', () => {
    it('el job global trae avisos de las zonas con propiedades disponibles, sin duplicar', async () => {
      await createProperty(adminToken, refsA.tolosa, refsA.casa)
      await createProperty(adminBToken, refsB.tolosa, refsB.casa)
      const facade = app.get(ValuationFacade)

      const first = await facade.refreshComparables()
      expect(first.zones).toBe(1)
      expect(first.sources[0]).toMatchObject({ source: 'FAKE', result: 'OK' })
      const count = await prisma.marketComparable.count()
      expect(count).toBe(20)

      // Una zona se corre a lo sumo una vez cada 24 h.
      const second = await facade.refreshComparables()
      expect(second.zones).toBe(0)

      // Forzada de nuevo: upsert por (fuente, id), sin duplicados.
      const zones = await prisma.valuationZone.findMany()
      const service = app.get(ComparablesRefreshService)
      const forced = await service.refresh(
        zones.map((z) => ({
          id: z.id,
          zoneKey: z.zoneKey,
          category: z.category as never,
          lastRefreshedAt: z.lastRefreshedAt,
          lastResult: null,
        })),
        new Date(),
      )
      expect(forced.created).toBe(0)
      expect(forced.updated).toBe(20)
      expect(await prisma.marketComparable.count()).toBe(20)

      const status = await api(adminToken)
        .get('/valuation/market-status')
        .expect(200)
      expect(
        status.body.data.sources.find((s: any) => s.source === 'FAKE'),
      ).toMatchObject({ status: 'OK', activeComparables: 20 })
    })

    it('después del refresco se puede tasar con los avisos de la fuente de prueba', async () => {
      const propertyId = await createProperty(
        adminToken,
        refsA.tolosa,
        refsA.casa,
      )
      await app.get(ValuationFacade).refreshComparables()
      // Primero hay que registrar la zona: la pide el propio alta de la propiedad al refrescar.
      const res = await api(adminToken)
        .post(`/valuation/properties/${propertyId}/appraise`)
        .send({})
        .expect(201)
      expect(res.body.data.comparablesUsed).toBeGreaterThanOrEqual(8)
      expect(res.body.data.comparablesDiscarded).toBeGreaterThanOrEqual(1)
    })

    it('una fuente BLOQUEADA o con PARSE_ERROR no rompe a las demás ni al job', async () => {
      registry.push(
        new ScriptedSource(Source.ZONAPROP, 'blocked'),
        new ScriptedSource(Source.ARGENPROP, 'parse'),
      )
      await createProperty(adminToken, refsA.tolosa, refsA.casa)

      const summary = await app.get(ValuationFacade).refreshComparables()

      const result = Object.fromEntries(
        summary.sources.map((s) => [s.source, s.result]),
      )
      expect(result).toEqual({
        FAKE: 'OK',
        ZONAPROP: 'BLOCKED',
        ARGENPROP: 'PARSE_ERROR',
      })
      expect(await prisma.marketComparable.count()).toBe(20)
      const states = Object.fromEntries(
        (await prisma.valuationSourceState.findMany()).map((s) => [
          s.source,
          s,
        ]),
      )
      expect(states.ZONAPROP.blockedUntil).not.toBeNull()
      expect(states.FAKE.consecutiveFailures).toBe(0)

      const status = await api(adminToken)
        .get('/valuation/market-status')
        .expect(200)
      const by = Object.fromEntries(
        status.body.data.sources.map((s: any) => [s.source, s.status]),
      )
      expect(by.ZONAPROP).toBe('BLOCKED')
      expect(by.ARGENPROP).toBe('PARSE_ERROR')
      expect(by.FAKE).toBe('OK')

      // La bloqueada no se vuelve a tocar por 24 h.
      const blocked = registry[1] as ScriptedSource
      const callsBefore = blocked.calls
      const zones = await prisma.valuationZone.findMany()
      const again = await app.get(ComparablesRefreshService).refresh(
        zones.map((z) => ({
          id: z.id,
          zoneKey: z.zoneKey,
          category: z.category as never,
          lastRefreshedAt: z.lastRefreshedAt,
          lastResult: null,
        })),
        new Date(),
      )
      expect(blocked.calls).toBe(callsBefore)
      expect(again.sources.find((s) => s.source === 'ZONAPROP')?.result).toBe(
        'SKIPPED',
      )
    })

    it('si todas las fuentes fallan el job termina FAILED', async () => {
      fake.failWith(new SourceParseError(Source.FAKE, 'roto'))
      await createProperty(adminToken, refsA.tolosa, refsA.casa)

      // Un ADMIN de una inmobiliaria ya no puede disparar el job global de
      // mercado (D-254); acá se encola como lo haría el horario.
      const res = await api(adminToken)
        .post('/automations/jobs/valuation.refresh-comparables/run')
        .send({})
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('AUTOMATION_JOB_GLOBAL')
      const definition = findJobDefinition('valuation.refresh-comparables')
      if (!definition) throw new Error('falta el job en el catálogo')
      await app.get(JobScheduler).enqueue(definition, null, {
        triggeredBy: JobTrigger.SCHEDULE,
        scheduledFor: localMoment().date,
        slot: '03:00',
      })
      await waitFor(
        async () =>
          (await prisma.jobExecution.count({
            where: { job: 'valuation.refresh-comparables', status: 'FAILED' },
          })) > 0,
      )
      const execution = await prisma.jobExecution.findFirstOrThrow({
        where: { job: 'valuation.refresh-comparables' },
      })
      expect(execution.tenantId).toBeNull()
    })

    it('3 corridas seguidas sin datos avisan sólo a quien tasó en los últimos 30 días, una vez por día', async () => {
      await seedComparables(TOLOSA, SIX)
      const propA = await createProperty(adminToken, refsA.tolosa, refsA.casa)
      await createProperty(adminBToken, refsB.tolosa, refsB.casa)
      await api(adminToken)
        .post(`/valuation/properties/${propA}/appraise`)
        .send({})
        .expect(201)
      fake.use(TOLOSA, [])
      const service = app.get(ComparablesRefreshService)
      const zones = await prisma.valuationZone.findMany()
      const refs = zones.map((z) => ({
        id: z.id,
        zoneKey: z.zoneKey,
        category: z.category as never,
        lastRefreshedAt: z.lastRefreshedAt,
        lastResult: null,
      }))

      for (let run = 0; run < 3; run += 1) {
        const summary = await service.refresh(refs, new Date())
        expect(summary.staleSources).toEqual(run === 2 ? ['FAKE'] : [])
      }
      await service.notifyStale([Source.FAKE], new Date())
      await service.notifyStale([Source.FAKE], new Date())

      const alerts = await prisma.notificationLog.findMany({
        where: { type: 'COMPARABLES_SOURCE_STALE' },
      })
      expect(alerts.map((a: { tenantId: string }) => a.tenantId)).toEqual([
        tenantA.id,
      ])
    })

    it('POST /valuation/zones/refresh (admin) encola y responde 202 con un AsyncJob', async () => {
      const res = await api(adminToken)
        .post('/valuation/zones/refresh')
        .send({ locationId: refsA.tolosa })
        .expect(202)
      const jobId = res.body.data.jobId as string
      expect(jobId).toBeDefined()

      let status = ''
      await waitFor(async () => {
        status = (
          await api(adminToken).get(`/jobs/${jobId}/status`).expect(200)
        ).body.data.status
        return ['COMPLETED', 'FAILED'].includes(status)
      })
      expect(status).toBe('COMPLETED')
      expect(
        await prisma.marketComparable.count({ where: { zoneKey: TOLOSA } }),
      ).toBeGreaterThan(0)

      await api(adminToken)
        .post('/valuation/zones/refresh')
        .send({ locationId: UNKNOWN_ID })
        .expect(404)
      await api(adminToken)
        .post('/valuation/zones/refresh')
        .send({})
        .expect(400)
    })
  })

  describe('auditoría', () => {
    it('cada tasación queda en el historial de auditoría de la inmobiliaria', async () => {
      await seedComparables(TOLOSA, SIX)
      const propertyId = await createProperty(
        adminToken,
        refsA.tolosa,
        refsA.casa,
      )
      const res = await api(adminToken)
        .post(`/valuation/properties/${propertyId}/appraise`)
        .send({})
        .expect(201)

      const logs = await prisma.auditLog.findMany({
        where: { entity: 'ValuationRequest', entityId: res.body.data.id },
      })
      expect(logs).toHaveLength(1)
      expect(logs[0]).toMatchObject({ action: 'CREATE', tenantId: tenantA.id })
    })
  })
})
