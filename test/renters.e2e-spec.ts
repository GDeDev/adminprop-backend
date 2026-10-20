import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import request from 'supertest'

import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'

const ivan = {
  firstName: 'Iván',
  lastName: 'López',
  nationalId: '30.123.456',
  phone: '221 555-1234',
  email: 'ivan@correo.com',
  moveInDate: '2026-03-01',
}

const marta = {
  firstName: 'Marta',
  lastName: 'Gómez',
  nationalId: '27.999.888',
  phone: '221 444-5678',
  guaranteeType: 'PROPERTY',
  guaranteeDetail: 'Calle 7 123, La Plata. Matrícula 12345.',
}

/** Inquilinos y garantes (spec Fase 8): criterios de aceptación, casos borde y aislamiento. */
describe('Inquilinos y garantes (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string }
  let admin: { id: string }
  let adminToken: string
  let employeeToken: string
  let adminBToken: string

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

  const createGuarantor = async (
    body: object = marta,
    token = adminToken,
  ): Promise<string> => {
    const response = await api(token).post('/guarantors').send(body).expect(201)
    return response.body.data.id
  }

  const createRenter = async (
    body: object = ivan,
    token = adminToken,
  ): Promise<string> => {
    const response = await api(token).post('/renters').send(body).expect(201)
    return response.body.data.id
  }

  const portalLogin = (email: string, password: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/portal-login')
      .send({ tenantSlug: tenantA.slug, email, password, type: 'RENTER' })

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
  })

  describe('alta de inquilino', () => {
    it('crea el inquilino con el DNI normalizado, su garante y los placeholders', async () => {
      const guarantorId = await createGuarantor()
      const response = await api(employeeToken)
        .post('/renters')
        .send({ ...ivan, guarantorId })
        .expect(201)

      expect(response.body.data).toMatchObject({
        fullName: 'Iván López',
        nationalId: '30123456',
        email: 'ivan@correo.com',
        moveInDate: '2026-03-01',
        guarantor: {
          id: guarantorId,
          fullName: 'Marta Gómez',
          nationalId: '27999888',
          guaranteeType: 'PROPERTY',
          guaranteeDetail: marta.guaranteeDetail,
        },
        hasPortalAccess: false,
        paymentStatus: null,
        activeContract: null,
        payments: [],
      })
    })

    it('sin garante está permitido (caso borde)', async () => {
      const response = await api(adminToken)
        .post('/renters')
        .send(ivan)
        .expect(201)
      expect(response.body.data.guarantor).toBeNull()
    })

    it('DNI repetido en la misma inmobiliaria → 409, aunque venga con otro formato', async () => {
      await createRenter()
      const response = await api(adminToken)
        .post('/renters')
        .send({ ...ivan, firstName: 'Otro', nationalId: '30123456' })
        .expect(409)
      expect(response.body.code).toBe('RENTER_NATIONAL_ID_TAKEN')
    })

    it('el mismo DNI en otra inmobiliaria está permitido', async () => {
      await createRenter()
      await api(adminBToken).post('/renters').send(ivan).expect(201)
    })

    it('un inquilino borrado libera su DNI', async () => {
      const id = await createRenter()
      await api(adminToken).delete(`/renters/${id}`).expect(204)
      await createRenter()
    })

    it('garante inexistente → 422 con código propio', async () => {
      const response = await api(adminToken)
        .post('/renters')
        .send({ ...ivan, guarantorId: '00000000-0000-4000-8000-000000000000' })
        .expect(422)
      expect(response.body.code).toBe('RENTER_INVALID_GUARANTOR')
    })

    it('DNI con menos de 7 dígitos → 400', async () => {
      const response = await api(adminToken)
        .post('/renters')
        .send({ ...ivan, nationalId: '12.345' })
        .expect(400)
      expect(response.body.code).toBe('RENTER_INVALID_NATIONAL_ID')
    })

    it('fecha de ingreso que no existe en el calendario → 400', async () => {
      await api(adminToken)
        .post('/renters')
        .send({ ...ivan, moveInDate: '01/03/2026' })
        .expect(400)
      const response = await api(adminToken)
        .post('/renters')
        .send({ ...ivan, moveInDate: '2026-02-30' })
        .expect(400)
      expect(response.body.code).toBe('RENTER_INVALID_MOVE_IN_DATE')
    })
  })

  describe('garantes', () => {
    it('crea el garante con el DNI normalizado y sin inquilinos', async () => {
      const response = await api(employeeToken)
        .post('/guarantors')
        .send(marta)
        .expect(201)
      expect(response.body.data).toMatchObject({
        fullName: 'Marta Gómez',
        nationalId: '27999888',
        guaranteeType: 'PROPERTY',
        renterCount: 0,
        renters: [],
      })
    })

    it('detalle de la garantía vacío → 400', async () => {
      const response = await api(adminToken)
        .post('/guarantors')
        .send({ ...marta, guaranteeDetail: '   ' })
        .expect(400)
      expect(response.body.code).toBe('GUARANTOR_DETAIL_REQUIRED')
    })

    it('tipo de garantía desconocido → 400', async () => {
      await api(adminToken)
        .post('/guarantors')
        .send({ ...marta, guaranteeType: 'AVAL' })
        .expect(400)
    })

    it('DNI repetido → 409', async () => {
      await createGuarantor()
      const response = await api(adminToken)
        .post('/guarantors')
        .send({ ...marta, nationalId: '27999888' })
        .expect(409)
      expect(response.body.code).toBe('GUARANTOR_NATIONAL_ID_TAKEN')
    })

    it('un garante puede estar vinculado a dos inquilinos', async () => {
      const guarantorId = await createGuarantor()
      const first = await createRenter({ ...ivan, guarantorId })
      const second = await createRenter({
        ...ivan,
        firstName: 'Ana',
        nationalId: '31000111',
        guarantorId,
      })

      const response = await api(adminToken)
        .get(`/guarantors/${guarantorId}`)
        .expect(200)
      expect(response.body.data.renterCount).toBe(2)
      expect(response.body.data.renters).toEqual([
        { id: second, fullName: 'Ana López' },
        { id: first, fullName: 'Iván López' },
      ])
    })

    it('con inquilinos a cargo no se borra → 409; sin ellos, sí', async () => {
      const guarantorId = await createGuarantor()
      const renterId = await createRenter({ ...ivan, guarantorId })

      const blocked = await api(adminToken)
        .delete(`/guarantors/${guarantorId}`)
        .expect(409)
      expect(blocked.body.code).toBe('GUARANTOR_IN_USE')

      await api(adminToken)
        .patch(`/renters/${renterId}`)
        .send({ guarantorId: null })
        .expect(200)
      await api(adminToken).delete(`/guarantors/${guarantorId}`).expect(204)
      await api(adminToken).get(`/guarantors/${guarantorId}`).expect(404)
    })

    it('un empleado no puede borrar un garante → 403', async () => {
      const guarantorId = await createGuarantor()
      await api(employeeToken).delete(`/guarantors/${guarantorId}`).expect(403)
    })

    it('chequeo en vivo del DNI', async () => {
      const guarantorId = await createGuarantor()
      const taken = await api(employeeToken)
        .get('/guarantors/check?nationalId=27.999.888')
        .expect(200)
      expect(taken.body.data).toEqual({
        nationalIdTakenBy: { id: guarantorId, fullName: 'Marta Gómez' },
      })

      const own = await api(employeeToken)
        .get(`/guarantors/check?nationalId=27999888&excludeId=${guarantorId}`)
        .expect(200)
      expect(own.body.data.nationalIdTakenBy).toBeNull()
    })

    it('busca por nombre o DNI, en cualquier orden', async () => {
      await createGuarantor()
      await createGuarantor({
        ...marta,
        firstName: 'Pedro',
        lastName: 'Núñez',
        nationalId: '20111222',
      })

      const byName = await api(adminToken)
        .get('/guarantors?search=GOMEZ%20marta')
        .expect(200)
      expect(
        byName.body.data.data.map((g: { fullName: string }) => g.fullName),
      ).toEqual(['Marta Gómez'])

      const byDni = await api(adminToken)
        .get('/guarantors?search=20.111')
        .expect(200)
      expect(byDni.body.data.data[0].fullName).toBe('Pedro Núñez')
    })
  })

  describe('edición de inquilino', () => {
    it('el cambio de garante queda en la auditoría con el antes y el después', async () => {
      const first = await createGuarantor()
      const second = await createGuarantor({
        ...marta,
        firstName: 'Pedro',
        nationalId: '20111222',
        guaranteeType: 'PAYSLIPS',
        guaranteeDetail: 'Empleado en Acme SA, $1.500.000',
      })
      const id = await createRenter({ ...ivan, guarantorId: first })

      const response = await api(employeeToken)
        .patch(`/renters/${id}`)
        .send({ guarantorId: second })
        .expect(200)
      expect(response.body.data.guarantor).toMatchObject({
        id: second,
        guaranteeType: 'PAYSLIPS',
      })

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { entity: 'Renter', entityId: id, action: 'UPDATE' },
      })
      expect(log.changes).toMatchObject({
        guarantorId: { before: first, after: second },
      })
    })

    it('cambiar el DNI por uno tomado → 409; por el propio, no', async () => {
      const id = await createRenter()
      await createRenter({ ...ivan, firstName: 'Ana', nationalId: '31000111' })

      await api(adminToken)
        .patch(`/renters/${id}`)
        .send({ nationalId: '31.000.111' })
        .expect(409)
      await api(adminToken)
        .patch(`/renters/${id}`)
        .send({ nationalId: '30.123.456', phone: '221 000-0000' })
        .expect(200)
    })

    it('chequeo en vivo del DNI, sin contar al propio inquilino', async () => {
      const id = await createRenter()
      const taken = await api(employeeToken)
        .get('/renters/check?nationalId=30.123.456')
        .expect(200)
      expect(taken.body.data).toEqual({
        nationalIdTakenBy: { id, fullName: 'Iván López' },
      })

      const own = await api(employeeToken)
        .get(`/renters/check?nationalId=30123456&excludeId=${id}`)
        .expect(200)
      expect(own.body.data.nationalIdTakenBy).toBeNull()
    })
  })

  describe('acceso al portal', () => {
    it('sin email no se puede generar → 422', async () => {
      const id = await createRenter({ ...ivan, email: null })
      const response = await api(adminToken)
        .post(`/renters/${id}/portal-credentials`)
        .expect(422)
      expect(response.body.code).toBe('RENTER_EMAIL_REQUIRED')
    })

    it('devuelve la contraseña una vez; regenerarla invalida la anterior', async () => {
      const id = await createRenter()
      const first = await api(employeeToken)
        .post(`/renters/${id}/portal-credentials`)
        .expect(201)
      const { email, password } = first.body.data
      expect(email).toBe('ivan@correo.com')
      const login = await portalLogin(email, password).expect(200)
      expect(login.body.data.user.role).toBe('RENTER')

      const second = await api(employeeToken)
        .post(`/renters/${id}/portal-credentials`)
        .expect(201)
      expect(second.body.data.userId).toBe(first.body.data.userId)
      expect(second.body.data.password).not.toBe(password)

      await portalLogin(email, password).expect(401)
      await portalLogin(email, second.body.data.password).expect(200)

      const renter = await api(adminToken).get(`/renters/${id}`).expect(200)
      expect(renter.body.data.hasPortalAccess).toBe(true)
    })

    it('la contraseña no queda en ninguna respuesta posterior', async () => {
      const id = await createRenter()
      const issued = await api(adminToken)
        .post(`/renters/${id}/portal-credentials`)
        .expect(201)
      const detail = await api(adminToken).get(`/renters/${id}`).expect(200)
      expect(JSON.stringify(detail.body)).not.toContain(
        issued.body.data.password,
      )
    })
  })

  describe('baja de inquilino', () => {
    it('un empleado no puede borrar → 403', async () => {
      const id = await createRenter()
      await api(employeeToken).delete(`/renters/${id}`).expect(403)
    })

    it('sin contratos borra y le corta el acceso al portal', async () => {
      const id = await createRenter()
      const issued = await api(adminToken)
        .post(`/renters/${id}/portal-credentials`)
        .expect(201)

      await api(adminToken).delete(`/renters/${id}`).expect(204)
      await api(adminToken).get(`/renters/${id}`).expect(404)
      await portalLogin(
        issued.body.data.email,
        issued.body.data.password,
      ).expect(401)
    })
  })

  describe('listado', () => {
    it('busca por nombre, apellido o DNI, en cualquier orden', async () => {
      const guarantorId = await createGuarantor()
      await createRenter({ ...ivan, guarantorId })
      await createRenter({
        firstName: 'Ana',
        lastName: 'Pérez',
        nationalId: '31000111',
      })

      // Sin acentos, en otro orden y en mayúsculas: igual lo encuentra.
      const byName = await api(adminToken)
        .get('/renters?search=LOPEZ%20ivan')
        .expect(200)
      expect(byName.body.data.data).toHaveLength(1)
      expect(byName.body.data.data[0]).toMatchObject({
        fullName: 'Iván López',
        guarantor: { id: guarantorId, fullName: 'Marta Gómez' },
        paymentStatus: null,
      })

      const byDni = await api(adminToken)
        .get('/renters?search=31.000')
        .expect(200)
      expect(byDni.body.data.data[0].fullName).toBe('Ana Pérez')
    })

    it('acepta los filtros de las Fases 9 y 11 sin filtrar todavía, y valida sus valores', async () => {
      await createRenter()
      const response = await api(adminToken)
        .get(
          '/renters?paymentStatus=OVERDUE&propertyId=00000000-0000-4000-8000-000000000000',
        )
        .expect(200)
      expect(response.body.data.data).toHaveLength(1)

      await api(adminToken).get('/renters?paymentStatus=MOROSO').expect(400)
      await api(adminToken).get('/renters?propertyId=no-es-uuid').expect(400)
    })
  })

  describe('aislamiento entre inmobiliarias', () => {
    it('otra inmobiliaria no ve, no edita ni borra al inquilino', async () => {
      const id = await createRenter()

      await api(adminBToken).get(`/renters/${id}`).expect(404)
      await api(adminBToken)
        .patch(`/renters/${id}`)
        .send({ phone: 'x' })
        .expect(404)
      await api(adminBToken)
        .post(`/renters/${id}/portal-credentials`)
        .expect(404)
      await api(adminBToken).delete(`/renters/${id}`).expect(404)

      const list = await api(adminBToken).get('/renters').expect(200)
      expect(list.body.data.data).toHaveLength(0)
      const check = await api(adminBToken)
        .get('/renters/check?nationalId=30123456')
        .expect(200)
      expect(check.body.data.nationalIdTakenBy).toBeNull()
    })

    it('otra inmobiliaria no ve, no edita ni borra al garante', async () => {
      const id = await createGuarantor()

      await api(adminBToken).get(`/guarantors/${id}`).expect(404)
      await api(adminBToken)
        .patch(`/guarantors/${id}`)
        .send({ phone: 'x' })
        .expect(404)
      await api(adminBToken).delete(`/guarantors/${id}`).expect(404)

      const list = await api(adminBToken).get('/guarantors').expect(200)
      expect(list.body.data.data).toHaveLength(0)
    })

    it('un inquilino no puede apuntar a un garante de otra inmobiliaria', async () => {
      const foreignGuarantor = await createGuarantor(marta, adminBToken)

      const created = await api(adminToken)
        .post('/renters')
        .send({ ...ivan, guarantorId: foreignGuarantor })
        .expect(422)
      expect(created.body.code).toBe('RENTER_INVALID_GUARANTOR')

      const id = await createRenter()
      await api(adminToken)
        .patch(`/renters/${id}`)
        .send({ guarantorId: foreignGuarantor })
        .expect(422)
    })
  })

  it('el alta queda en la auditoría con su autor', async () => {
    const id = await createRenter()
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entity: 'Renter', entityId: id, action: 'CREATE' },
    })
    expect(log).toMatchObject({ tenantId: tenantA.id, userId: admin.id })
  })
})
