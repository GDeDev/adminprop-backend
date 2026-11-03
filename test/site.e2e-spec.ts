import { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Role } from '@prisma/client'
import request from 'supertest'

import { seedBaseMasterData } from '../prisma/lib/master-data-seed'
import {
  DnsTxtPort,
  SiteRevalidationPort,
} from '../src/modules/site/domain/site.ports'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0, 0, 0, 13]),
  Buffer.from('IHDR', 'latin1'),
  Buffer.from([0, 0, 3, 32, 0, 0, 2, 88]), // 800 x 600
  Buffer.alloc(8),
])

/** Sitio web de la inmobiliaria: configuración, publicación, host, vista previa e imágenes. */
/** DNS de mentira: lo que cada host "tiene" como TXT. */
class FakeDns extends DnsTxtPort {
  records = new Map<string, string[]>()
  resolveTxt(host: string): Promise<string[]> {
    return Promise.resolve(this.records.get(host) ?? [])
  }
}

class FakeRevalidation extends SiteRevalidationPort {
  slugs: string[] = []
  /** Demora simulada de la otra app (el aviso real tarda hasta 3 s). */
  delayMs = 0
  revalidate(slug: string): Promise<void> {
    this.slugs.push(slug)
    return new Promise((resolve) => setTimeout(resolve, this.delayMs))
  }
}

describe('Sitio web (e2e, Postgres)', () => {
  const dns = new FakeDns()
  const revalidation = new FakeRevalidation()
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string }
  let tenantB: { id: string }
  let adminA: string
  let adminB: string
  let employeeA: string

  const as = (token: string) => ({
    get: (url: string) =>
      request(app.getHttpServer())
        .get(`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`),
    put: (url: string) =>
      request(app.getHttpServer())
        .put(`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`),
    post: (url: string) =>
      request(app.getHttpServer())
        .post(`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`),
  })
  const pub = (url: string) => request(app.getHttpServer()).get(`/api/v1${url}`)

  const settingsOf = async (token: string) =>
    (await as(token).get('/site/settings').expect(200)).body.data

  const hero = (title: string) => ({
    title,
    subtitle: null,
    ctaLabel: null,
    backgroundImageUrl: null,
    showSearch: true,
  })

  const save = (token: string, body: Record<string, unknown>) =>
    as(token).put('/site/settings').send(body)

  beforeAll(async () => {
    await prisma.$connect()
    app = await createTestApp((builder) =>
      builder
        .overrideProvider(DnsTxtPort)
        .useValue(dns)
        .overrideProvider(SiteRevalidationPort)
        .useValue(revalidation),
    )
  })

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    dns.records.clear()
    revalidation.slugs = []
    revalidation.delayMs = 0
    await resetDatabase(prisma)
    tenantA = await createTenant(prisma, 'tenant-a')
    tenantB = await createTenant(prisma, 'tenant-b')
    await prisma.tenant.update({
      where: { id: tenantA.id },
      data: {
        phone: '221 555 0001',
        whatsapp: '5492215550001',
        primaryColor: '#E07A1F',
        address: 'Calle 7 123',
      },
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
    adminA = await loginAs(app, 'admin@a.com')
    employeeA = await loginAs(app, 'emp@a.com')
    adminB = await loginAs(app, 'admin@b.com')
  })

  describe('permisos', () => {
    it('sin sesión es 401 y un empleado recibe 403 en todo /site', async () => {
      const routes: [string, string][] = [
        ['get', '/site/templates'],
        ['get', '/site/settings'],
        ['put', '/site/settings'],
        ['post', '/site/settings/reset-template'],
        ['post', '/site/publish'],
        ['post', '/site/unpublish'],
        ['post', '/site/assets'],
        ['get', '/site/preview-token'],
        ['get', '/site/subdomain-availability'],
      ]
      for (const [method, url] of routes) {
        const anon = await (
          request(app.getHttpServer()) as never as Record<
            string,
            (u: string) => request.Test
          >
        )[method](`/api/v1${url}`)
        expect(anon.status).toBe(401)
        const emp = await (
          as(employeeA) as unknown as Record<
            string,
            (u: string) => request.Test
          >
        )
          [method](url)
          .send({})
        expect(emp.status).toBe(403)
      }
    })
  })

  describe('configuración', () => {
    it('lista los dos templates con tema, secciones y tipografías', async () => {
      const { body } = await as(adminA).get('/site/templates').expect(200)
      expect(body.data.map((t: { key: string }) => t.key)).toEqual([
        'CLASSIC',
        'MODERN',
      ])
      expect(body.data[0].defaultTheme.background).toBe('#181C14')
      expect(body.data[0].supportedSections).toContain('hero')
      expect(body.data[1].fontOptions.length).toBeGreaterThan(1)
    })

    it('el primer GET crea el sitio con los datos de la inmobiliaria, deshabilitado', async () => {
      expect(await prisma.siteSettings.count()).toBe(0)

      const data = await settingsOf(adminA)

      expect(data).toMatchObject({
        enabled: false,
        publishedAt: null,
        hasUnpublishedChanges: true,
        subdomain: null,
        customDomain: null,
        publicUrl: 'http://localhost:3003/_s/tenant-a',
      })
      expect(data.draft.template).toBe('CLASSIC')
      expect(data.draft.theme.primary).toBe('#E07A1F')
      expect(data.draft.content.brand.displayName).toBe('Inmobiliaria tenant-a')
      expect(data.draft.content.contact).toMatchObject({
        phone: '221 555 0001',
        whatsapp: '5492215550001',
        address: 'Calle 7 123',
      })
      expect(await prisma.siteSettings.count()).toBe(1)
      // Un segundo GET no crea otra.
      await settingsOf(adminA)
      expect(await prisma.siteSettings.count()).toBe(1)
    })

    it('guarda el borrador parcial sin tocar lo publicado, y devuelve errores por campo', async () => {
      await settingsOf(adminA)

      const ok = await save(adminA, {
        theme: { primary: '#112233' },
        content: { hero: hero('Hola mundo') },
      }).expect(200)
      expect(ok.body.data.draft.theme.primary).toBe('#112233')
      expect(ok.body.data.draft.theme.background).toBe('#181C14')
      expect(ok.body.data.draft.content.hero.title).toBe('Hola mundo')
      expect(ok.body.data.draft.content.faqs.length).toBeGreaterThan(0)

      const bad = await save(adminA, {
        theme: { primary: 'azul' },
        content: { hero: hero('') },
      }).expect(422)
      const fields = bad.body.errors.map((e: { field: string }) => e.field)
      expect(fields).toEqual(
        expect.arrayContaining(['theme.primary', 'content.hero.title']),
      )
      // Lo inválido no se guardó.
      expect((await settingsOf(adminA)).draft.theme.primary).toBe('#112233')
    })

    it('cambiar de template conserva el contenido y ajusta la tipografía que no existe', async () => {
      await settingsOf(adminA)
      await save(adminA, { theme: { fontKey: 'serif' } }).expect(200)

      const modern = await save(adminA, { template: 'MODERN' }).expect(200)

      expect(modern.body.data.draft.template).toBe('MODERN')
      expect(modern.body.data.draft.theme.fontKey).toBe('system')
      expect(modern.body.data.draft.theme.background).toBe('#181C14') // el tema no se pisa solo
      expect(modern.body.data.draft.content.brand.displayName).toBe(
        'Inmobiliaria tenant-a',
      )
      await save(adminA, { template: 'NOPE' }).expect(422)
    })

    it('reset-template restaura el tema, con o sin conservar el contenido', async () => {
      await settingsOf(adminA)
      await save(adminA, {
        template: 'MODERN',
        theme: { primary: '#FF0000', radius: 0 },
        content: { hero: hero('Mi título') },
      }).expect(200)

      const keep = await as(adminA)
        .post('/site/settings/reset-template')
        .send({ keepContent: true })
        .expect(200)
      expect(keep.body.data.draft.theme).toMatchObject({
        primary: '#1D4ED8',
        radius: 16,
        background: '#FFFFFF',
      })
      expect(keep.body.data.draft.content.hero.title).toBe('Mi título')

      const all = await as(adminA)
        .post('/site/settings/reset-template')
        .send({ keepContent: false })
        .expect(200)
      expect(all.body.data.draft.content.hero.title).not.toBe('Mi título')
      await as(adminA)
        .post('/site/settings/reset-template')
        .send({})
        .expect(400)
    })
  })

  describe('seguridad del contenido', () => {
    it('ningún texto del editor acepta HTML ni scripts', async () => {
      await settingsOf(adminA)
      const payload = '<img src=x onerror=alert(1)>'
      const attempts: Record<string, unknown>[] = [
        { content: { hero: hero(payload) } },
        {
          content: {
            brand: {
              displayName: payload,
              tagline: null,
              logoUrl: null,
              faviconUrl: null,
            },
          },
        },
        {
          content: {
            faqs: [{ question: payload, answer: '<script>1</script>' }],
          },
        },
        {
          content: {
            about: {
              title: 'x',
              body: '<iframe src=//evil></iframe>',
              imageUrl: null,
            },
          },
        },
        {
          content: {
            seo: { title: payload, description: 'ok', ogImageUrl: null },
          },
        },
      ]
      for (const attempt of attempts) {
        const response = await save(adminA, attempt).expect(422)
        expect(response.body.errors.length).toBeGreaterThan(0)
      }
      const stored = JSON.stringify((await settingsOf(adminA)).draft)
      expect(stored).not.toContain('onerror')
      expect(stored).not.toContain('<script')
    })

    it('rechaza claves de más, links javascript:, imágenes ajenas y redes que no son de la red', async () => {
      await settingsOf(adminA)
      await save(adminA, { content: { evil: 1 } }).expect(422)
      await save(adminA, {
        content: {
          contact: {
            address: null,
            hours: null,
            phone: null,
            whatsapp: null,
            whatsappMessage: null,
            email: null,
            socials: [{ network: 'INSTAGRAM', url: 'javascript:alert(1)' }],
          },
        },
      }).expect(422)
      await save(adminA, {
        content: {
          contact: {
            address: null,
            hours: null,
            phone: null,
            whatsapp: null,
            whatsappMessage: null,
            email: null,
            socials: [
              { network: 'INSTAGRAM', url: 'https://evil.com/instagram.com' },
            ],
          },
        },
      }).expect(422)
      const image = await save(adminA, {
        content: {
          hero: {
            ...hero('ok'),
            backgroundImageUrl: 'https://evil.test/x.png',
          },
        },
      }).expect(422)
      expect(image.body.errors[0].field).toBe('content.hero.backgroundImageUrl')
    })
  })

  describe('imágenes', () => {
    const upload = (token: string, buffer: Buffer, filename = 'a.png') =>
      as(token).post('/site/assets').attach('file', buffer, filename)

    it('sube una imagen válida y se puede usar en el contenido', async () => {
      const { body } = await upload(adminA, PNG).expect(201)
      expect(body.data).toMatchObject({ width: 800, height: 600 })
      expect(body.data.url).toContain(`/tenants/${tenantA.id}/site/`)

      await settingsOf(adminA)
      await save(adminA, {
        content: {
          hero: { ...hero('Con foto'), backgroundImageUrl: body.data.url },
        },
      }).expect(200)
    })

    it('rechaza SVG, HTML disfrazado de imagen, vacíos y archivos de más de 5 MB', async () => {
      await upload(
        adminA,
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        'a.svg',
      ).expect(400)
      await upload(
        adminA,
        Buffer.from('<html><script>alert(1)</script></html>'),
        'a.png',
      ).expect(400)
      await upload(adminA, Buffer.from('%PDF-1.4'), 'a.png').expect(400)
      await as(adminA).post('/site/assets').expect(400)
      const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 1)])
      const response = await upload(adminA, big)
      expect([400, 413]).toContain(response.status)
    })

    it('una imagen subida por otra inmobiliaria no sirve en este sitio', async () => {
      const { body } = await upload(adminB, PNG).expect(201)
      await settingsOf(adminA)
      await save(adminA, {
        content: {
          hero: { ...hero('Ajena'), backgroundImageUrl: body.data.url },
        },
      }).expect(422)
    })
  })

  describe('subdominio y dominio propio', () => {
    it('valida, es único en todo el sistema (409) y se puede quitar', async () => {
      await settingsOf(adminA)
      await settingsOf(adminB)

      const ok = await save(adminA, { subdomain: 'Mi-Inmo' }).expect(200)
      expect(ok.body.data.subdomain).toBe('mi-inmo')
      expect(ok.body.data.publicUrl).toBe('https://mi-inmo.sites.test')

      const taken = await save(adminB, { subdomain: 'mi-inmo' }).expect(409)
      expect(taken.body.code).toBe('SUBDOMAIN_TAKEN')

      for (const bad of ['ab', 'www', 'con espacios', 'Ñandú', 'a.b']) {
        const response = await save(adminA, { subdomain: bad }).expect(422)
        expect(response.body.errors[0].field).toBe('subdomain')
      }

      const domain = await save(adminA, {
        customDomain: 'www.mi-inmo.com.ar',
      }).expect(200)
      // Sin verificar el dominio no cuenta: la URL pública sigue siendo el subdominio.
      expect(domain.body.data.customDomain).toBe('www.mi-inmo.com.ar')
      expect(domain.body.data.publicUrl).toBe('https://mi-inmo.sites.test')
      await save(adminA, { customDomain: 'https://x.com' }).expect(422)
      await save(adminA, { customDomain: 'x.sites.test' }).expect(422)

      await save(adminA, { subdomain: null, customDomain: null }).expect(200)
      await save(adminB, { subdomain: 'mi-inmo' }).expect(200) // liberado
    })

    it('informa la disponibilidad de un subdominio', async () => {
      await settingsOf(adminA)
      await save(adminA, { subdomain: 'ocupado' }).expect(200)
      const check = (token: string, value: string) =>
        as(token)
          .get(
            `/site/subdomain-availability?value=${encodeURIComponent(value)}`,
          )
          .expect(200)

      expect((await check(adminB, 'ocupado')).body.data).toMatchObject({
        available: false,
      })
      expect((await check(adminB, 'libre')).body.data).toMatchObject({
        available: true,
        reason: null,
      })
      expect((await check(adminB, 'www')).body.data).toMatchObject({
        available: false,
      })
      // El propio subdominio no cuenta como ocupado para su dueño.
      expect((await check(adminA, 'ocupado')).body.data.available).toBe(true)
    })
  })

  describe('publicar y despublicar', () => {
    it('sin publicar el sitio público es 404, igual que una inmobiliaria inexistente', async () => {
      await settingsOf(adminA)
      const unpublished = await pub('/public/tenant-a/site').expect(404)
      const unknown = await pub('/public/no-existe/site').expect(404)
      expect(unpublished.body.code).toBe('SITE_NOT_FOUND')
      expect(unknown.body).toMatchObject({
        code: 'SITE_NOT_FOUND',
        message: unpublished.body.message,
      })
    })

    it('publica: lo público lee lo publicado y no el borrador; despublicar vuelve a 404 sin perder nada', async () => {
      await settingsOf(adminA)
      await save(adminA, {
        content: { hero: hero('Título publicado') },
      }).expect(200)

      const published = await as(adminA).post('/site/publish').expect(200)
      expect(published.body.data).toMatchObject({
        enabled: true,
        hasUnpublishedChanges: false,
      })
      expect(published.body.data.publishedAt).toEqual(expect.any(String))

      const site = await pub('/public/tenant-a/site').expect(200)
      expect(site.headers['cache-control']).toContain('s-maxage=60')
      expect(site.body.data).toMatchObject({
        template: 'CLASSIC',
        tenant: {
          slug: 'tenant-a',
          name: 'Inmobiliaria tenant-a',
          logoUrl: null,
        },
      })
      expect(site.body.data.content.hero.title).toBe('Título publicado')

      // Cambios sin publicar no se ven.
      const edited = await save(adminA, {
        content: { hero: hero('Borrador nuevo') },
      }).expect(200)
      expect(edited.body.data.hasUnpublishedChanges).toBe(true)
      expect(
        (await pub('/public/tenant-a/site').expect(200)).body.data.content.hero
          .title,
      ).toBe('Título publicado')

      const off = await as(adminA).post('/site/unpublish').expect(200)
      expect(off.body.data).toMatchObject({
        enabled: false,
        hasUnpublishedChanges: true,
      })
      await pub('/public/tenant-a/site').expect(404)
      // Idempotente y sin perder la configuración.
      await as(adminA).post('/site/unpublish').expect(200)
      expect((await settingsOf(adminA)).draft.content.hero.title).toBe(
        'Borrador nuevo',
      )

      // Volver a publicar muestra el borrador.
      await as(adminA).post('/site/publish').expect(200)
      expect(
        (await pub('/public/tenant-a/site').expect(200)).body.data.content.hero
          .title,
      ).toBe('Borrador nuevo')
    })

    it('no publica un sitio incompleto: 422 con los campos', async () => {
      await settingsOf(adminA)
      await save(adminA, {
        content: {
          sections: [
            { key: 'hero', visible: true },
            { key: 'testimonials', visible: true },
            { key: 'about', visible: true },
          ],
          seo: { title: '', description: '', ogImageUrl: null },
        },
      }).expect(200)

      const response = await as(adminA).post('/site/publish').expect(422)
      expect(
        response.body.errors.map((e: { field: string }) => e.field),
      ).toEqual(
        expect.arrayContaining([
          'content.testimonials',
          'content.about.body',
          'content.seo.title',
        ]),
      )
      await pub('/public/tenant-a/site').expect(404)
    })

    it('no publica con un texto que no se lee (contraste AA)', async () => {
      await settingsOf(adminA)
      await save(adminA, {
        theme: { text: '#777777', background: '#888888' },
      }).expect(200)
      const response = await as(adminA).post('/site/publish').expect(422)
      expect(
        response.body.errors.map((e: { field: string }) => e.field),
      ).toContain('theme.text')
    })

    it('las destacadas a mano tienen que existir en la inmobiliaria', async () => {
      await settingsOf(adminA)
      const other = await as(adminB)
        .post('/properties')
        .send({
          address: 'Ajena 1',
          locationId: (
            await prisma.location.findFirstOrThrow({
              where: { tenantId: tenantB.id, name: 'Tolosa' },
            })
          ).id,
          propertyTypeId: (
            await prisma.propertyType.findFirstOrThrow({
              where: { tenantId: tenantB.id, name: 'Casa' },
            })
          ).id,
        })
        .expect(201)

      await save(adminA, {
        content: {
          featured: {
            title: 'Destacadas',
            subtitle: null,
            count: 6,
            mode: 'MANUAL',
            propertyIds: [other.body.data.id],
          },
        },
      }).expect(200)
      const response = await as(adminA).post('/site/publish').expect(422)
      expect(response.body.errors[0].field).toBe('content.featured.propertyIds')
    })

    it('registra en el historial el cambio de template, dominio, publicar y despublicar', async () => {
      await settingsOf(adminA)
      await save(adminA, { template: 'MODERN', subdomain: 'auditada' }).expect(
        200,
      )
      await as(adminA).post('/site/publish').expect(200)
      await as(adminA).post('/site/unpublish').expect(200)

      const logs = await prisma.auditLog.findMany({
        where: { tenantId: tenantA.id, entity: 'SiteSettings' },
        orderBy: { createdAt: 'asc' },
      })
      const changes = logs.map((l) => JSON.stringify(l.changes))
      expect(logs.length).toBeGreaterThanOrEqual(4)
      expect(
        changes.some((c) => c.includes('templateKey') && c.includes('MODERN')),
      ).toBe(true)
      expect(
        changes.some((c) => c.includes('subdomain') && c.includes('auditada')),
      ).toBe(true)
      expect(
        changes.some((c) => c.includes('"enabled"') && c.includes('true')),
      ).toBe(true)
      expect(
        changes.some((c) => c.includes('"enabled"') && c.includes('false')),
      ).toBe(true)
      // El contenido no engorda el historial.
      expect(changes.join('')).not.toContain('displayName')
      expect(logs.every((l) => l.userId !== null)).toBe(true)
    })
  })

  describe('resolución por host', () => {
    const publish = async (token: string, body: Record<string, unknown>) => {
      await settingsOf(token)
      await save(token, body).expect(200)
      await as(token).post('/site/publish').expect(200)
    }
    const byHost = (host: string) =>
      pub(`/public/site-by-host?host=${encodeURIComponent(host)}`)

    it('resuelve subdominio y dominio propio (verificado) de sitios publicados', async () => {
      await publish(adminA, {
        subdomain: 'mi-inmo',
        customDomain: 'www.mi-inmo.com.ar',
      })
      const record = (await as(adminA).get('/site/domain').expect(200)).body
        .data.record
      dns.records.set(record.host, [record.value])
      await as(adminA).post('/site/domain/verify').expect(200)

      expect(
        (await byHost('mi-inmo.sites.test').expect(200)).body.data,
      ).toEqual({ slug: 'tenant-a' })
      expect(
        (await byHost('MI-INMO.sites.test:443').expect(200)).body.data.slug,
      ).toBe('tenant-a')
      expect(
        (await byHost('www.mi-inmo.com.ar').expect(200)).body.data.slug,
      ).toBe('tenant-a')
      // El TXT prueba control de un nombre exacto: el dominio pelado NO resuelve.
      await byHost('mi-inmo.com.ar').expect(404)
      await byHost('otro.sites.test').expect(404)
      await byHost('otro.com').expect(404)
      await byHost('').expect(404)
      await pub('/public/site-by-host').expect(404)
    })

    it('un sitio sin publicar o despublicado no resuelve (tras vencer la caché)', async () => {
      await settingsOf(adminA)
      await save(adminA, { subdomain: 'borrador' }).expect(200)
      await byHost('borrador.sites.test').expect(404)

      await as(adminA).post('/site/publish').expect(200)
      await byHost('borrador.sites.test').expect(200)

      await as(adminA).post('/site/unpublish').expect(200)
      await byHost('borrador.sites.test').expect(404)
    })

    it('una inmobiliaria deshabilitada deja de resolver', async () => {
      await publish(adminA, { subdomain: 'baja' })
      await prisma.tenant.update({
        where: { id: tenantA.id },
        data: { isActive: false },
      })
      const resolver = app.get(
        (await import('../src/modules/site/application/site-host-resolver'))
          .SiteHostResolver,
      )
      resolver.invalidate()
      await byHost('baja.sites.test').expect(404)
      await pub('/public/tenant-a/site').expect(404)
    })
  })

  describe('dominio propio: verificación', () => {
    const byHost = (host: string) =>
      pub(`/public/site-by-host?host=${encodeURIComponent(host)}`)
    const domainOf = async (token: string) =>
      (await as(token).get('/site/domain').expect(200)).body.data

    it('arranca sin verificar, da el registro TXT y no resuelve el sitio', async () => {
      await settingsOf(adminA)
      await save(adminA, { customDomain: 'www.mi-inmo.com.ar' }).expect(200)
      await as(adminA).post('/site/publish').expect(200)

      const state = await domainOf(adminA)
      expect(state).toMatchObject({
        customDomain: 'www.mi-inmo.com.ar',
        verified: false,
        verificationRequired: true,
        record: { type: 'TXT', host: '_adminprop-verify.www.mi-inmo.com.ar' },
      })
      expect(state.record.value).toMatch(/^adminprop-verify=[0-9a-f]{32}$/)
      await byHost('www.mi-inmo.com.ar').expect(404)
    })

    it('el valor del registro es propio de cada inmobiliaria y de cada dominio', async () => {
      await settingsOf(adminA)
      await settingsOf(adminB)
      await save(adminA, { customDomain: 'mi-inmo.com.ar' }).expect(200)
      await save(adminB, { customDomain: 'mi-inmo.com.ar' }).expect(200)
      const a = (await domainOf(adminA)).record.value
      const b = (await domainOf(adminB)).record.value
      expect(a).not.toBe(b)

      await save(adminA, { customDomain: 'otro.com.ar' }).expect(200)
      expect((await domainOf(adminA)).record.value).not.toBe(a)
    })

    it('verifica con el TXT correcto, y recién ahí resuelve y avisa a la app de sitios', async () => {
      await settingsOf(adminA)
      await save(adminA, { customDomain: 'www.mi-inmo.com.ar' }).expect(200)
      await as(adminA).post('/site/publish').expect(200)
      const { record } = await domainOf(adminA)

      // Sin registro, o con uno ajeno: 422 con el host donde buscamos.
      const missing = await as(adminA).post('/site/domain/verify').expect(422)
      expect(missing.body.code).toBe('DOMAIN_NOT_VERIFIED')
      expect(missing.body.message).toContain(record.host)
      dns.records.set(record.host, [
        'adminprop-verify=ffffffffffffffffffffffffffffffff',
      ])
      await as(adminA).post('/site/domain/verify').expect(422)

      dns.records.set(record.host, ['v=spf1 -all', record.value])
      revalidation.slugs = []
      const ok = await as(adminA).post('/site/domain/verify').expect(200)
      expect(ok.body.data.publicUrl).toBe('https://www.mi-inmo.com.ar')
      expect(await domainOf(adminA)).toMatchObject({ verified: true })
      expect(revalidation.slugs).toEqual(['tenant-a'])
      await byHost('www.mi-inmo.com.ar').expect(200)
      // Idempotente.
      await as(adminA).post('/site/domain/verify').expect(200)
    })

    it('reservar un dominio sin verificar no bloquea a otra inmobiliaria; el que verifica primero se lo queda', async () => {
      await settingsOf(adminA)
      await settingsOf(adminB)
      await save(adminA, { customDomain: 'www.mi-inmo.com.ar' }).expect(200)
      // B lo reserva también (no hay conflicto: nadie lo verificó).
      await save(adminB, { customDomain: 'WWW.mi-inmo.com.ar' }).expect(200)

      const b = (await domainOf(adminB)).record
      dns.records.set(b.host, [b.value])
      await as(adminB).post('/site/domain/verify').expect(200)

      // A ya no puede verificarlo ni volver a reservarlo: es de B.
      const a = (await domainOf(adminA)).record
      dns.records.set(a.host, [a.value])
      expect(
        (await as(adminA).post('/site/domain/verify').expect(409)).body.code,
      ).toBe('DOMAIN_TAKEN')
      const again = await save(adminA, {
        customDomain: 'otro.mi-inmo.com.ar',
      }).expect(200)
      expect(again.body.data.customDomain).toBe('otro.mi-inmo.com.ar')
      expect(
        (await save(adminA, { customDomain: 'www.mi-inmo.com.ar' }).expect(409))
          .body.code,
      ).toBe('DOMAIN_TAKEN')
    })

    it('cambiar o quitar el dominio lo deja sin verificar; sin dominio no hay nada que verificar', async () => {
      await settingsOf(adminA)
      await as(adminA).post('/site/domain/verify').expect(422)
      await save(adminA, { customDomain: 'www.mi-inmo.com.ar' }).expect(200)
      const { record } = await domainOf(adminA)
      dns.records.set(record.host, [record.value])
      await as(adminA).post('/site/domain/verify').expect(200)

      await save(adminA, { customDomain: 'www.nuevo.com.ar' }).expect(200)
      expect(await domainOf(adminA)).toMatchObject({ verified: false })
      await save(adminA, { customDomain: null }).expect(200)
      expect(await domainOf(adminA)).toMatchObject({
        customDomain: null,
        verified: false,
        record: null,
      })
    })

    it('un empleado no puede verlo ni verificarlo (403)', async () => {
      await as(employeeA).get('/site/domain').expect(403)
      await as(employeeA).post('/site/domain/verify').expect(403)
    })
  })

  describe('avisos a la app de sitios y primer acceso', () => {
    it('publicar y despublicar avisan con el slug; si ya estaba apagado no avisa', async () => {
      await settingsOf(adminA)
      await as(adminA).post('/site/publish').expect(200)
      expect(revalidation.slugs).toEqual(['tenant-a'])
      await as(adminA).post('/site/unpublish').expect(200)
      await as(adminA).post('/site/unpublish').expect(200)
      expect(revalidation.slugs).toEqual(['tenant-a', 'tenant-a'])
    })

    it('publicar no espera al aviso a la app de sitios (aunque tarde 3 s)', async () => {
      await settingsOf(adminA)
      revalidation.delayMs = 3_000

      const started = Date.now()
      await as(adminA).post('/site/publish').expect(200)
      const elapsed = Date.now() - started

      // Se avisó, pero el administrador no esperó los 3 s.
      expect(revalidation.slugs).toEqual(['tenant-a'])
      expect(elapsed).toBeLessThan(2_000)
    })

    it('dos pedidos simultáneos del primer acceso crean una sola configuración (sin 500)', async () => {
      const responses = await Promise.all(
        Array.from({ length: 4 }, () => as(adminA).get('/site/settings')),
      )
      expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200])
      expect(await prisma.siteSettings.count()).toBe(1)
    })

    it('guardar el borrador deja en el historial qué bloques se tocaron, sin el contenido', async () => {
      await settingsOf(adminA)
      await save(adminA, {
        theme: { primary: '#112233' },
        content: { hero: hero('Texto que no debe ir al historial') },
      }).expect(200)

      const log = await prisma.auditLog.findFirstOrThrow({
        where: {
          tenantId: tenantA.id,
          entity: 'SiteSettings',
          summary: 'Sitio web: borrador guardado',
        },
      })
      const changes = JSON.stringify(log.changes)
      expect(changes).toContain('hero')
      expect(changes).toContain('primary')
      expect(changes).not.toContain('Texto que no debe ir')
      expect(log.userId).not.toBeNull()
    })

    it('la subida de imágenes tiene tope por minuto', async () => {
      // THROTTLE_ENABLED=false en los e2e: acá solo se verifica que el decorador exista.
      const reflect = Reflect.getMetadataKeys(
        (
          await import('../src/modules/site/infrastructure/http/controllers/site.controller')
        ).SiteController.prototype.upload,
      )
      expect(reflect.some((k: string) => String(k).includes('THROTTLER'))).toBe(
        true,
      )
    })
  })

  describe('vista previa', () => {
    it('el token abre el borrador (aunque no esté publicado), sin caché ni indexación', async () => {
      await settingsOf(adminA)
      await save(adminA, {
        content: { hero: hero('Solo en borrador') },
      }).expect(200)

      const { body } = await as(adminA).get('/site/preview-token').expect(200)
      expect(body.data.token).toEqual(expect.any(String))
      expect(new Date(body.data.expiresAt).getTime()).toBeGreaterThan(
        Date.now(),
      )

      const preview = await pub(
        `/public/tenant-a/site?preview=${body.data.token}`,
      ).expect(200)
      expect(preview.body.data.content.hero.title).toBe('Solo en borrador')
      expect(preview.headers['cache-control']).toBe('no-store')
      expect(preview.headers['x-robots-tag']).toBe('noindex')
      // Sin el token, nada.
      await pub('/public/tenant-a/site').expect(404)
    })

    it('el token es de una sola inmobiliaria, no vale como access token y uno inválido es 404', async () => {
      await settingsOf(adminA)
      await settingsOf(adminB)
      const { body } = await as(adminA).get('/site/preview-token').expect(200)

      // De A no abre el borrador de B.
      await pub(`/public/tenant-b/site?preview=${body.data.token}`).expect(404)
      await pub('/public/tenant-a/site?preview=basura').expect(404)
      // Y no sirve para la API autenticada.
      await request(app.getHttpServer())
        .get('/api/v1/site/settings')
        .set('Authorization', `Bearer ${body.data.token}`)
        .expect(401)
      // Un access token tampoco abre la vista previa.
      await pub(`/public/tenant-a/site?preview=${adminA}`).expect(404)

      const expired = await app
        .get(JwtService)
        .signAsync(
          { typ: 'site-preview', tid: tenantA.id },
          {
            secret: `site-preview:${process.env.JWT_ACCESS_SECRET}`,
            expiresIn: -10,
          },
        )
        .catch(() => 'expired')
      await pub(`/public/tenant-a/site?preview=${expired}`).expect(404)
    })
  })

  describe('aislamiento entre inmobiliarias', () => {
    it('dos inmobiliarias con templates distintos no se ven ni se mezclan', async () => {
      await settingsOf(adminA)
      await settingsOf(adminB)
      await save(adminA, {
        content: { hero: hero('Sitio de A') },
        subdomain: 'sitio-a',
      }).expect(200)
      await save(adminB, {
        template: 'MODERN',
        content: { hero: hero('Sitio de B') },
        subdomain: 'sitio-b',
      }).expect(200)
      await as(adminA).post('/site/publish').expect(200)
      await as(adminB).post('/site/publish').expect(200)

      const a = (await pub('/public/tenant-a/site').expect(200)).body.data
      const b = (await pub('/public/tenant-b/site').expect(200)).body.data
      expect(a).toMatchObject({
        template: 'CLASSIC',
        tenant: { slug: 'tenant-a' },
      })
      expect(b).toMatchObject({
        template: 'MODERN',
        tenant: { slug: 'tenant-b' },
      })
      expect(a.content.hero.title).toBe('Sitio de A')
      expect(b.content.hero.title).toBe('Sitio de B')
      expect(JSON.stringify(a)).not.toContain('tenant-b')

      // Cada admin ve y edita solo lo suyo.
      expect((await settingsOf(adminA)).subdomain).toBe('sitio-a')
      expect((await settingsOf(adminB)).subdomain).toBe('sitio-b')
      await as(adminB).post('/site/unpublish').expect(200)
      await pub('/public/tenant-b/site').expect(404)
      await pub('/public/tenant-a/site').expect(200)

      const rows = await prisma.siteSettings.findMany({
        orderBy: { tenantId: 'asc' },
      })
      expect(rows).toHaveLength(2)
    })

    it('el listado público trae solo las propiedades de cada sitio, y las no disponibles no salen', async () => {
      const make = async (token: string, tenantId: string, address: string) => {
        const res = await as(token)
          .post('/properties')
          .send({
            address,
            locationId: (
              await prisma.location.findFirstOrThrow({
                where: { tenantId, name: 'Tolosa' },
              })
            ).id,
            propertyTypeId: (
              await prisma.propertyType.findFirstOrThrow({
                where: { tenantId, name: 'Casa' },
              })
            ).id,
            listingPrice: '100000',
            listingOperation: 'SALE',
            bedrooms: 3,
          })
          .expect(201)
        return res.body.data.id as string
      }
      const a1 = await make(adminA, tenantA.id, 'Casa de A')
      await make(adminB, tenantB.id, 'Casa de B')
      const rented = await make(adminA, tenantA.id, 'Alquilada de A')
      await request(app.getHttpServer())
        .patch(`/api/v1/properties/${rented}/status`)
        .set('Authorization', `Bearer ${adminA}`)
        .send({ status: 'MAINTENANCE' })
        .expect(200)

      const list = (
        await pub('/public/tenant-a/properties?operation=SALE').expect(200)
      ).body.data.data
      expect(list.map((p: { id: string }) => p.id)).toEqual([a1])
      expect(list[0]).toMatchObject({ bedrooms: 3, operation: 'SALE' })
      await pub(`/public/tenant-a/properties/${rented}`).expect(404)
    })

    it('el contacto del sitio crea la consulta en la inmobiliaria correcta', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/public/tenant-a/contact')
        .send({
          name: 'Ana',
          email: 'ana@mail.com',
          phone: '',
          message: 'Hola',
          propertyId: null,
          website: '',
        })
        .expect(201)
      const mine = await as(adminA).get('/inquiries').expect(200)
      const theirs = await as(adminB).get('/inquiries').expect(200)
      expect(mine.body.data.data).toHaveLength(1)
      expect(theirs.body.data.data).toHaveLength(0)
    })
  })
})
