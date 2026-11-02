import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import request from 'supertest'

import { seedBaseMasterData } from '../prisma/lib/master-data-seed'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginAs, loginToPortalAs } from './utils/app'
import {
  createTenant,
  createUser,
  resetDatabase,
  TEST_PASSWORD,
} from './utils/database'

/**
 * Auditoría (Fase 20): eventos de acceso, pantalla del admin, aislamiento
 * entre inmobiliarias e inmutabilidad de la tabla.
 */
describe('Auditoría (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string }
  let tenantB: { id: string }
  let adminToken: string
  let adminBToken: string
  let employeeToken: string

  const get = (token: string, url: string) =>
    request(app.getHttpServer())
      .get(`/api/v1${url}`)
      .set('Authorization', `Bearer ${token}`)

  const post = (token: string, url: string) =>
    request(app.getHttpServer())
      .post(`/api/v1${url}`)
      .set('Authorization', `Bearer ${token}`)

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
    await createUser(prisma, {
      tenantId: tenantA.id,
      email: 'admin@a.com',
      role: Role.ADMIN,
    })
    await createUser(prisma, {
      tenantId: tenantA.id,
      email: 'empleado@a.com',
      role: Role.EMPLOYEE,
    })
    await createUser(prisma, {
      tenantId: tenantB.id,
      email: 'admin@b.com',
      role: Role.ADMIN,
    })
    adminToken = await loginAs(app, 'admin@a.com')
    employeeToken = await loginAs(app, 'empleado@a.com')
    adminBToken = await loginAs(app, 'admin@b.com')
  })

  describe('accesos', () => {
    it('registra el login exitoso del admin con su usuario, tipo de actor y frase', async () => {
      const list = await get(adminToken, '/audit?action=LOGIN&limit=50').expect(
        200,
      )
      const rows = list.body.data.data as Array<Record<string, any>>
      const mine = rows.find((row) => row.userEmail === 'admin@a.com')
      expect(mine).toMatchObject({
        entity: 'User',
        action: 'LOGIN',
        actorKind: 'USER',
        summary: 'Inició sesión',
      })
      expect(mine?.userId).toEqual(expect.any(String))
      // Ni el login de empleado ni el de la otra inmobiliaria se mezclan con otros tenants.
      expect(rows.map((row) => row.userEmail)).not.toContain('admin@b.com')
    })

    it('registra el login fallido con la contraseña mal y el cierre de sesión', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'empleado@a.com', password: 'ClaveIncorrecta9' })
        .expect(401)

      const failed = await get(adminToken, '/audit?action=LOGIN_FAILED').expect(
        200,
      )
      expect(failed.body.data.data[0]).toMatchObject({
        action: 'LOGIN_FAILED',
        userEmail: 'empleado@a.com',
        summary: 'Intento de acceso fallido',
      })

      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'empleado@a.com', password: TEST_PASSWORD })
        .expect(200)
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({ refreshToken: login.body.data.tokens.refreshToken })
        .expect(204)

      const logouts = await get(adminToken, '/audit?action=LOGOUT').expect(200)
      expect(logouts.body.data.data[0]).toMatchObject({
        action: 'LOGOUT',
        userEmail: 'empleado@a.com',
        actorKind: 'USER',
      })
    })

    it('distingue el actor del portal de propietarios y el de inquilinos', async () => {
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
      await loginToPortalAs(app, 'tenant-a', 'duenio@a.com', 'OWNER')
      await loginToPortalAs(app, 'tenant-a', 'inquilino@a.com', 'RENTER')

      const kinds = await Promise.all(
        ['PORTAL_OWNER', 'PORTAL_RENTER'].map((actorKind) =>
          get(adminToken, `/audit?action=LOGIN&actorKind=${actorKind}`).expect(
            200,
          ),
        ),
      )
      expect(kinds[0].body.data.data.map((r: any) => r.userEmail)).toEqual([
        'duenio@a.com',
      ])
      expect(kinds[1].body.data.data.map((r: any) => r.userEmail)).toEqual([
        'inquilino@a.com',
      ])
    })

    it('un email desconocido deja una fila global que ninguna inmobiliaria ve', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nadie@nada.com', password: 'ClaveIncorrecta9' })
        .expect(401)

      const global = await prisma.auditLog.findMany({
        where: { action: 'LOGIN_FAILED', tenantId: null },
      })
      expect(global).toHaveLength(1)
      expect(global[0]).toMatchObject({ userEmail: 'nadie@nada.com' })

      for (const token of [adminToken, adminBToken]) {
        const list = await get(token, '/audit?action=LOGIN_FAILED').expect(200)
        expect(list.body.data.data).toEqual([])
      }
    })
  })

  describe('permisos y aislamiento', () => {
    it('sólo el admin lo ve: el empleado recibe 403 en todas las rutas', async () => {
      for (const url of [
        '/audit',
        '/audit/entities',
        '/audit/entity/Property/abc',
        '/audit/export?format=xlsx',
      ]) {
        await get(employeeToken, url).expect(403)
      }
    })

    it('cada inmobiliaria ve sólo lo suyo, en el listado, el detalle y el historial', async () => {
      const owner = await post(adminToken, '/owners')
        .send({
          firstName: 'Ana',
          lastName: 'Gómez',
          nationalId: '30111222',
          email: 'ana@mail.com',
        })
        .expect(201)
      const ownerId = owner.body.data.id as string

      const own = await get(
        adminToken,
        `/audit?entity=Owner&entityId=${ownerId}`,
      ).expect(200)
      expect(own.body.data.data).toHaveLength(1)
      const entry = own.body.data.data[0]
      expect(entry).toMatchObject({
        entity: 'Owner',
        action: 'CREATE',
        actorKind: 'USER',
        userEmail: 'admin@a.com',
      })
      expect(entry.summary).toContain('Creó el propietario Ana Gómez')

      const other = await get(adminBToken, '/audit?entity=Owner').expect(200)
      expect(other.body.data.data).toEqual([])
      await get(adminBToken, `/audit/${entry.id}`).expect(404)
      const history = await get(
        adminBToken,
        `/audit/entity/Owner/${ownerId}`,
      ).expect(200)
      expect(history.body.data).toEqual([])

      const mineHistory = await get(
        adminToken,
        `/audit/entity/Owner/${ownerId}`,
      ).expect(200)
      expect(mineHistory.body.data).toHaveLength(1)
    })

    it('el detalle trae el diff campo por campo con los nombres de los ids', async () => {
      const owner = await post(adminToken, '/owners')
        .send({
          firstName: 'Ana',
          lastName: 'Gómez',
          nationalId: '30111222',
        })
        .expect(201)
      const property = await post(adminToken, '/properties')
        .send({
          address: 'Calle 1 100',
          locationId: (
            await prisma.location.findFirstOrThrow({
              where: { tenantId: tenantA.id, name: 'Tolosa' },
            })
          ).id,
          propertyTypeId: (
            await prisma.propertyType.findFirstOrThrow({
              where: { tenantId: tenantA.id, name: 'Casa' },
            })
          ).id,
          ownerId: owner.body.data.id,
        })
        .expect(201)

      const list = await get(
        adminToken,
        `/audit?entity=Property&entityId=${property.body.data.id}`,
      ).expect(200)
      const detail = await get(
        adminToken,
        `/audit/${list.body.data.data[0].id}`,
      ).expect(200)

      const changes = detail.body.data.changes as Array<Record<string, any>>
      const ownerChange = changes.find((c) => c.field === 'ownerId')
      expect(ownerChange).toMatchObject({
        after: owner.body.data.id,
        afterLabel: 'Ana Gómez',
      })
      expect(detail.body.data.userEmail).toBe('admin@a.com')
    })

    it('el catálogo lista las entidades y las acciones', async () => {
      const catalog = await get(adminToken, '/audit/entities').expect(200)
      expect(catalog.body.data.entities).toEqual(
        expect.arrayContaining(['Owner', 'Contract', 'Payment', 'Report']),
      )
      expect(catalog.body.data.actions).toEqual(
        expect.arrayContaining(['LOGIN', 'NOTIFICATION_SENT', 'EXPORT']),
      )
    })

    it('filtra por fechas y por texto', async () => {
      const future = await get(adminToken, '/audit?from=2999-01-01').expect(200)
      expect(future.body.data.data).toEqual([])

      const today = await get(
        adminToken,
        `/audit?from=${new Date().toISOString().slice(0, 10)}&search=admin@a.com`,
      ).expect(200)
      expect(today.body.data.pagination.total).toBeGreaterThan(0)

      await get(adminToken, '/audit?from=ayer').expect(400)
    })
  })

  describe('exportación', () => {
    it('descarga un XLSX y deja constancia de la exportación', async () => {
      const response = await get(
        adminToken,
        '/audit/export?format=xlsx&action=LOGIN',
      )
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => callback(null, Buffer.concat(chunks)))
        })
        .expect(200)

      expect(response.headers['content-type']).toContain('spreadsheetml')
      expect(response.headers['content-disposition']).toContain(
        'attachment; filename="auditoria-',
      )
      // Un XLSX es un zip.
      expect((response.body as Buffer).subarray(0, 2).toString()).toBe('PK')

      const exports = await get(adminToken, '/audit?action=EXPORT').expect(200)
      expect(exports.body.data.data[0]).toMatchObject({
        action: 'EXPORT',
        entity: 'Audit',
        userEmail: 'admin@a.com',
      })
    })

    it('rechaza un formato que no existe', async () => {
      await get(adminToken, '/audit/export?format=pdf').expect(400)
    })
  })

  describe('inmutabilidad', () => {
    it('la base rechaza editar o borrar una fila de auditoría', async () => {
      const row = await prisma.auditLog.findFirstOrThrow({
        where: { tenantId: tenantA.id },
      })
      await expect(
        prisma.auditLog.update({
          where: { id: row.id },
          data: { summary: 'adulterado' },
        }),
      ).rejects.toThrow(/inmutable/)
      await expect(
        prisma.auditLog.delete({ where: { id: row.id } }),
      ).rejects.toThrow(/inmutable/)
      await expect(
        prisma.auditLog.deleteMany({ where: { tenantId: tenantA.id } }),
      ).rejects.toThrow(/inmutable/)
    })

    it('el TRUNCATE de los tests sigue funcionando', async () => {
      await resetDatabase(prisma)
      expect(await prisma.auditLog.count()).toBe(0)
    })
  })
})
