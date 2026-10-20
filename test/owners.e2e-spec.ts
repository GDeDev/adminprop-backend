import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import request from 'supertest'

import { seedBaseMasterData } from '../prisma/lib/master-data-seed'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'

/** CBUs con los dígitos verificadores bien. */
const CBU_1 = '0110599552000000123456'
const CBU_2 = '0170099222000000678900'

const juan = {
  firstName: 'Juan',
  lastName: 'Pérez',
  nationalId: '20.123.456',
  phone: '221 555-1234',
  email: 'juan@correo.com',
  bankAccount: { cbu: CBU_1, alias: 'casa.perez', holder: 'Juan Pérez' },
}

/** Propietarios (spec Fase 7): criterios de aceptación, casos borde y aislamiento. */
describe('Propietarios (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string }
  let admin: { id: string }
  let adminToken: string
  let employeeToken: string
  let adminBToken: string
  let refs: { tolosa: string; casa: string }

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

  const createOwner = async (body: object = juan): Promise<string> => {
    const response = await api(adminToken)
      .post('/owners')
      .send(body)
      .expect(201)
    return response.body.data.id
  }

  /**
   * Propiedades del propietario, cargadas directo: son preparación. Una
   * `RENTED` lleva un contrato activo (lo que cuenta para RN-07 desde la
   * Fase 9); `RENTED_BY_HAND` es alquilada a mano, sin contrato.
   */
  const giveProperties = async (
    ownerId: string,
    statuses: ('AVAILABLE' | 'RENTED' | 'RENTED_BY_HAND' | 'MAINTENANCE')[],
  ) => {
    for (const [i, status] of statuses.entries()) {
      await prisma.property.create({
        data: {
          tenantId: tenantA.id,
          address: `Calle ${i + 1}`,
          locationId: refs.tolosa,
          propertyTypeId: refs.casa,
          ownerId,
          status: status === 'RENTED_BY_HAND' ? 'RENTED' : status,
          activeContractId: status === 'RENTED' ? randomUUID() : null,
        },
      })
    }
  }

  const portalLogin = (email: string, password: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/portal-login')
      .send({ tenantSlug: tenantA.slug, email, password, type: 'OWNER' })

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

    refs = {
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

  describe('alta', () => {
    it('crea el propietario con el DNI normalizado y la cuenta bancaria', async () => {
      const response = await api(employeeToken)
        .post('/owners')
        .send(juan)
        .expect(201)

      expect(response.body.data).toMatchObject({
        fullName: 'Juan Pérez',
        nationalId: '20123456',
        email: 'juan@correo.com',
        bankAccount: {
          cbu: CBU_1,
          alias: 'casa.perez',
          bankName: null,
          holder: 'Juan Pérez',
        },
        propertyCount: 0,
        activePropertyCount: 0,
        reducedFee: false,
        hasPortalAccess: false,
        properties: [],
      })
    })

    it('DNI repetido en la misma inmobiliaria → 409, aunque venga con otro formato', async () => {
      await createOwner()
      const response = await api(adminToken)
        .post('/owners')
        .send({ ...juan, firstName: 'Otro', nationalId: '20123456' })
        .expect(409)
      expect(response.body.code).toBe('OWNER_NATIONAL_ID_TAKEN')
    })

    it('el mismo DNI en otra inmobiliaria está permitido', async () => {
      await createOwner()
      await api(adminBToken).post('/owners').send(juan).expect(201)
    })

    it('un propietario borrado libera su DNI', async () => {
      const id = await createOwner()
      await api(adminToken).delete(`/owners/${id}`).expect(204)
      await createOwner()
    })

    it('CBU que no tiene 22 dígitos → 400', async () => {
      await api(adminToken)
        .post('/owners')
        .send({ ...juan, bankAccount: { cbu: '123' } })
        .expect(400)
    })

    it('CBU con un dígito verificador mal → 400 con código propio', async () => {
      const response = await api(adminToken)
        .post('/owners')
        .send({ ...juan, bankAccount: { cbu: '0110599552000000123457' } })
        .expect(400)
      expect(response.body.code).toBe('OWNER_INVALID_CBU')
    })

    it('DNI con menos de 7 dígitos → 400', async () => {
      const response = await api(adminToken)
        .post('/owners')
        .send({ ...juan, nationalId: '12.345' })
        .expect(400)
      expect(response.body.code).toBe('OWNER_INVALID_NATIONAL_ID')
    })
  })

  describe('chequeo en vivo', () => {
    it('avisa el DNI tomado y quién más tiene el CBU', async () => {
      const id = await createOwner()
      const response = await api(employeeToken)
        .get(`/owners/check?nationalId=20.123.456&cbu=${CBU_1}`)
        .expect(200)
      expect(response.body.data).toEqual({
        nationalIdTakenBy: { id, fullName: 'Juan Pérez' },
        cbuSharedWith: [{ id, fullName: 'Juan Pérez' }],
      })
    })

    it('en una edición el propio propietario no cuenta', async () => {
      const id = await createOwner()
      const response = await api(employeeToken)
        .get(`/owners/check?nationalId=20123456&cbu=${CBU_1}&excludeId=${id}`)
        .expect(200)
      expect(response.body.data).toEqual({
        nationalIdTakenBy: null,
        cbuSharedWith: [],
      })
    })

    it('un CBU repetido no bloquea el alta (sólo se advierte)', async () => {
      await createOwner()
      await createOwner({
        firstName: 'Ana',
        lastName: 'Pérez',
        nationalId: '27999888',
        bankAccount: { cbu: CBU_1 },
      })
    })
  })

  describe('honorario reducido (RN-07)', () => {
    it('con 3 propiedades activas aplica', async () => {
      const id = await createOwner()
      await giveProperties(id, ['RENTED', 'RENTED', 'RENTED'])

      const response = await api(adminToken).get(`/owners/${id}`).expect(200)
      expect(response.body.data).toMatchObject({
        propertyCount: 3,
        activePropertyCount: 3,
        reducedFee: true,
      })
      expect(response.body.data.properties).toHaveLength(3)
    })

    it('con 2 activas y 1 sin contrato no aplica: sólo cuentan las activas', async () => {
      const id = await createOwner()
      await giveProperties(id, ['RENTED', 'RENTED', 'AVAILABLE'])

      const response = await api(adminToken).get(`/owners/${id}`).expect(200)
      expect(response.body.data).toMatchObject({
        propertyCount: 3,
        activePropertyCount: 2,
        reducedFee: false,
      })
    })

    it('una alquilada a mano, sin contrato, no cuenta (D-39 cerrada en la Fase 9)', async () => {
      const id = await createOwner()
      await giveProperties(id, ['RENTED', 'RENTED', 'RENTED_BY_HAND'])

      const response = await api(adminToken).get(`/owners/${id}`).expect(200)
      expect(response.body.data).toMatchObject({
        propertyCount: 3,
        activePropertyCount: 2,
        reducedFee: false,
      })
    })

    it('respeta el umbral de cada inmobiliaria', async () => {
      await prisma.tenant.update({
        where: { id: tenantA.id },
        data: { reducedFeeThreshold: 2 },
      })
      const id = await createOwner()
      await giveProperties(id, ['RENTED', 'RENTED'])

      const response = await api(adminToken).get('/owners').expect(200)
      expect(response.body.data.data[0]).toMatchObject({
        id,
        reducedFee: true,
      })
    })

    it('una propiedad borrada no cuenta', async () => {
      const id = await createOwner()
      await giveProperties(id, ['RENTED', 'RENTED', 'RENTED'])
      await prisma.property.updateMany({
        where: { ownerId: id, address: 'Calle 1' },
        data: { deletedAt: new Date() },
      })

      const response = await api(adminToken).get(`/owners/${id}`).expect(200)
      expect(response.body.data).toMatchObject({
        activePropertyCount: 2,
        reducedFee: false,
      })
    })
  })

  describe('acceso al portal', () => {
    it('sin email no se puede generar → 422', async () => {
      const id = await createOwner({ ...juan, email: null })
      const response = await api(adminToken)
        .post(`/owners/${id}/portal-credentials`)
        .expect(422)
      expect(response.body.code).toBe('OWNER_EMAIL_REQUIRED')
    })

    it('devuelve la contraseña una vez; regenerarla invalida la anterior', async () => {
      const id = await createOwner()
      const first = await api(employeeToken)
        .post(`/owners/${id}/portal-credentials`)
        .expect(201)
      const { email, password } = first.body.data
      expect(email).toBe('juan@correo.com')
      await portalLogin(email, password).expect(200)

      const second = await api(employeeToken)
        .post(`/owners/${id}/portal-credentials`)
        .expect(201)
      expect(second.body.data.userId).toBe(first.body.data.userId)
      expect(second.body.data.password).not.toBe(password)

      await portalLogin(email, password).expect(401)
      await portalLogin(email, second.body.data.password).expect(200)

      const owner = await api(adminToken).get(`/owners/${id}`).expect(200)
      expect(owner.body.data.hasPortalAccess).toBe(true)
    })

    it('la contraseña no queda en ninguna respuesta posterior', async () => {
      const id = await createOwner()
      const issued = await api(adminToken)
        .post(`/owners/${id}/portal-credentials`)
        .expect(201)
      const detail = await api(adminToken).get(`/owners/${id}`).expect(200)
      expect(JSON.stringify(detail.body)).not.toContain(
        issued.body.data.password,
      )
    })
  })

  describe('cuenta bancaria', () => {
    it('el cambio de CBU queda en la auditoría con el antes y el después', async () => {
      const id = await createOwner()
      const response = await api(employeeToken)
        .patch(`/owners/${id}/bank-account`)
        .send({ cbu: CBU_2, alias: 'nuevo.alias', holder: 'Juan Pérez' })
        .expect(200)
      expect(response.body.data.bankAccount.cbu).toBe(CBU_2)

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { entity: 'Owner', entityId: id, action: 'UPDATE' },
      })
      expect(log.changes).toMatchObject({
        bankCbu: { before: CBU_1, after: CBU_2 },
        bankAlias: { before: 'casa.perez', after: 'nuevo.alias' },
      })
    })

    it('editar los datos personales no toca la cuenta bancaria', async () => {
      const id = await createOwner()
      const response = await api(adminToken)
        .patch(`/owners/${id}`)
        .send({ phone: '221 000-0000', bankAccount: { cbu: CBU_2 } })
        .expect(400) // bankAccount no es un campo de este endpoint
      expect(response.body.success).toBe(false)

      const ok = await api(adminToken)
        .patch(`/owners/${id}`)
        .send({ phone: '221 000-0000' })
        .expect(200)
      expect(ok.body.data.bankAccount.cbu).toBe(CBU_1)
    })
  })

  describe('baja', () => {
    it('con propiedades asignadas → 409', async () => {
      const id = await createOwner()
      await giveProperties(id, ['RENTED'])
      const response = await api(adminToken).delete(`/owners/${id}`).expect(409)
      expect(response.body.code).toBe('OWNER_HAS_PROPERTIES')
    })

    it('un empleado no puede borrar → 403', async () => {
      const id = await createOwner()
      await api(employeeToken).delete(`/owners/${id}`).expect(403)
    })

    it('borra y le corta el acceso al portal', async () => {
      const id = await createOwner()
      const issued = await api(adminToken)
        .post(`/owners/${id}/portal-credentials`)
        .expect(201)

      await api(adminToken).delete(`/owners/${id}`).expect(204)
      await api(adminToken).get(`/owners/${id}`).expect(404)
      await portalLogin(
        issued.body.data.email,
        issued.body.data.password,
      ).expect(401)
    })
  })

  describe('listado', () => {
    it('busca por nombre, apellido o DNI, en cualquier orden', async () => {
      await createOwner()
      await createOwner({
        firstName: 'Ana',
        lastName: 'Gómez',
        nationalId: '27999888',
      })

      // Sin acentos, en otro orden y en mayúsculas: igual lo encuentra.
      const byName = await api(adminToken)
        .get('/owners?search=PEREZ%20juan')
        .expect(200)
      expect(
        byName.body.data.data.map((o: { fullName: string }) => o.fullName),
      ).toEqual(['Juan Pérez'])

      const byDni = await api(adminToken)
        .get('/owners?search=27.999')
        .expect(200)
      expect(byDni.body.data.data[0].fullName).toBe('Ana Gómez')
    })
  })

  describe('propiedades', () => {
    it('la propiedad muestra el nombre de su propietario', async () => {
      const ownerId = await createOwner()
      const created = await api(adminToken)
        .post('/properties')
        .send({
          address: 'Calle 7 123',
          locationId: refs.tolosa,
          propertyTypeId: refs.casa,
          ownerId,
        })
        .expect(201)
      expect(created.body.data.owner).toEqual({
        id: ownerId,
        fullName: 'Juan Pérez',
      })

      const list = await api(adminToken)
        .get(`/properties?ownerId=${ownerId}`)
        .expect(200)
      expect(list.body.data.data[0].owner.fullName).toBe('Juan Pérez')
    })

    it('no se puede asignar un propietario inexistente → 422', async () => {
      const response = await api(adminToken)
        .post('/properties')
        .send({
          address: 'Calle 7 123',
          locationId: refs.tolosa,
          propertyTypeId: refs.casa,
          ownerId: '00000000-0000-4000-8000-000000000000',
        })
        .expect(422)
      expect(response.body.code).toBe('PROPERTY_INVALID_OWNER')
    })
  })

  describe('aislamiento entre inmobiliarias', () => {
    it('otra inmobiliaria no ve, no edita ni borra al propietario', async () => {
      const id = await createOwner()

      await api(adminBToken).get(`/owners/${id}`).expect(404)
      await api(adminBToken)
        .patch(`/owners/${id}`)
        .send({ phone: 'x' })
        .expect(404)
      await api(adminBToken)
        .patch(`/owners/${id}/bank-account`)
        .send({ cbu: CBU_2 })
        .expect(404)
      await api(adminBToken)
        .post(`/owners/${id}/portal-credentials`)
        .expect(404)
      await api(adminBToken).delete(`/owners/${id}`).expect(404)

      const list = await api(adminBToken).get('/owners').expect(200)
      expect(list.body.data.data).toHaveLength(0)
      const check = await api(adminBToken)
        .get('/owners/check?nationalId=20123456')
        .expect(200)
      expect(check.body.data.nationalIdTakenBy).toBeNull()
    })

    it('una propiedad no puede apuntar a un propietario de otra inmobiliaria', async () => {
      const response = await api(adminBToken)
        .post('/owners')
        .send(juan)
        .expect(201)
      const foreignOwner = response.body.data.id

      await api(adminToken)
        .post('/properties')
        .send({
          address: 'Calle 7 123',
          locationId: refs.tolosa,
          propertyTypeId: refs.casa,
          ownerId: foreignOwner,
        })
        .expect(422)
    })
  })

  it('el alta queda en la auditoría con su autor', async () => {
    const id = await createOwner()
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entity: 'Owner', entityId: id, action: 'CREATE' },
    })
    expect(log).toMatchObject({ tenantId: tenantA.id, userId: admin.id })
  })
})
