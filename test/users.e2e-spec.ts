import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import request from 'supertest'

import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginAs } from './utils/app'
import {
  createTenant,
  createUser,
  resetDatabase,
  TEST_PASSWORD,
} from './utils/database'

/** Gestión de usuarios internos (spec Fase 4, 3.6). */
describe('Usuarios (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string }
  let admin: { id: string }
  let employee: { id: string }
  let adminToken: string

  const NEW_PASSWORD = 'ClaveNueva123'

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
    admin = await createUser(prisma, {
      tenantId: tenantA.id,
      email: 'admin@a.com',
      role: Role.ADMIN,
    })
    employee = await createUser(prisma, {
      tenantId: tenantA.id,
      email: 'emp@a.com',
      role: Role.EMPLOYEE,
    })
    adminToken = await loginAs(app, 'admin@a.com')
  })

  const http = () => request(app.getHttpServer())
  const asAdmin = (method: 'get' | 'post' | 'patch', url: string) =>
    http()[method](`/api/v1${url}`).set('Authorization', `Bearer ${adminToken}`)

  const validUser = {
    email: 'nueva@a.com',
    firstName: '  Nora ',
    lastName: 'Nueva',
    role: 'EMPLOYEE',
    password: 'ClaveInicial123',
  }

  describe('permisos', () => {
    it('un empleado no puede crear usuarios: 403', async () => {
      const employeeToken = await loginAs(app, 'emp@a.com')

      const response = await http()
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send(validUser)
        .expect(403)

      expect(response.body.code).toBe('INSUFFICIENT_PERMISSIONS')
    })

    it('un empleado tampoco puede listarlos', async () => {
      const employeeToken = await loginAs(app, 'emp@a.com')

      await http()
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403)
    })

    it('un empleado ascendido a admin puede gestionar desde su request siguiente', async () => {
      const employeeToken = await loginAs(app, 'emp@a.com')

      await asAdmin('patch', `/users/${employee.id}`)
        .send({ role: 'ADMIN' })
        .expect(200)

      // Mismo token, emitido cuando era empleado: manda el rol de la base.
      await http()
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(200)
    })
  })

  describe('listado', () => {
    it('lista admins y empleados de la inmobiliaria, sin los de portal ni los de otra', async () => {
      await createUser(prisma, {
        tenantId: tenantA.id,
        email: 'owner@a.com',
        role: Role.OWNER,
      })
      const tenantB = await createTenant(prisma, 'tenant-b')
      await createUser(prisma, { tenantId: tenantB.id, email: 'emp@b.com' })

      const response = await asAdmin('get', '/users').expect(200)

      const emails = response.body.data.data.map(
        (u: { email: string }) => u.email,
      )
      expect(emails.sort()).toEqual(['admin@a.com', 'emp@a.com'])
      expect(response.body.data.pagination).toMatchObject({
        page: 1,
        total: 2,
      })
    })

    it('filtra por rol y por activo', async () => {
      await prisma.user.update({
        where: { id: employee.id },
        data: { isActive: false },
      })

      const admins = await asAdmin('get', '/users?role=ADMIN').expect(200)
      const inactive = await asAdmin('get', '/users?isActive=false').expect(200)

      expect(admins.body.data.data.map((u: { id: string }) => u.id)).toEqual([
        admin.id,
      ])
      expect(inactive.body.data.data.map((u: { id: string }) => u.id)).toEqual([
        employee.id,
      ])
    })

    it('pagina', async () => {
      const response = await asAdmin('get', '/users?limit=1&page=2').expect(200)

      expect(response.body.data.data).toHaveLength(1)
      expect(response.body.data.pagination).toMatchObject({
        page: 2,
        limit: 1,
        total: 2,
        hasPreviousPage: true,
        hasNextPage: false,
      })
    })
  })

  describe('alta', () => {
    it('crea un empleado que después puede loguearse', async () => {
      const response = await asAdmin('post', '/users')
        .send(validUser)
        .expect(201)

      expect(response.body.data).toMatchObject({
        email: 'nueva@a.com',
        firstName: 'Nora',
        role: 'EMPLOYEE',
        tenantId: tenantA.id,
        isActive: true,
      })
      expect(response.body.data).not.toHaveProperty('passwordHash')

      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'nueva@a.com', password: 'ClaveInicial123' })
        .expect(200)
    })

    it('un email interno ya usado, aun en otra inmobiliaria, es 409', async () => {
      const tenantB = await createTenant(prisma, 'tenant-b')
      await createUser(prisma, {
        tenantId: tenantB.id,
        email: 'nueva@a.com',
      })

      const response = await asAdmin('post', '/users')
        .send(validUser)
        .expect(409)

      expect(response.body.code).toBe('EMAIL_ALREADY_REGISTERED')
    })

    it('rechaza una contraseña débil o un rol de portal', async () => {
      const response = await asAdmin('post', '/users')
        .send({ ...validUser, password: 'corta', role: 'OWNER' })
        .expect(400)

      const fields = response.body.errors.map((e: { field: string }) => e.field)
      expect(fields).toEqual(expect.arrayContaining(['password', 'role']))
    })
  })

  describe('aislamiento entre inmobiliarias', () => {
    it('un usuario de otra inmobiliaria no existe para este admin, ni para verlo ni para tocarlo', async () => {
      const tenantB = await createTenant(prisma, 'tenant-b')
      const other = await createUser(prisma, {
        tenantId: tenantB.id,
        email: 'emp@b.com',
      })

      await asAdmin('get', `/users/${other.id}`).expect(404)
      await asAdmin('patch', `/users/${other.id}`)
        .send({ firstName: 'Hackeado' })
        .expect(404)
      await asAdmin('patch', `/users/${other.id}/deactivate`).expect(404)
      await asAdmin('patch', `/users/${other.id}/password`)
        .send({ newPassword: NEW_PASSWORD })
        .expect(404)

      const intact = await prisma.user.findUniqueOrThrow({
        where: { id: other.id },
      })
      expect(intact).toMatchObject({ firstName: null, isActive: true })
    })

    it('un usuario de portal tampoco se gestiona por /users', async () => {
      const owner = await createUser(prisma, {
        tenantId: tenantA.id,
        email: 'owner@a.com',
        role: Role.OWNER,
      })

      const response = await asAdmin('get', `/users/${owner.id}`).expect(404)

      expect(response.body.code).toBe('USER_NOT_FOUND')
    })
  })

  describe('edición', () => {
    it('edita datos y rol', async () => {
      const response = await asAdmin('patch', `/users/${employee.id}`)
        .send({ firstName: 'Ernesto', lastName: 'Pérez', role: 'ADMIN' })
        .expect(200)

      expect(response.body.data).toMatchObject({
        firstName: 'Ernesto',
        lastName: 'Pérez',
        role: 'ADMIN',
      })
    })

    it('un admin no puede cambiarse su propio rol', async () => {
      const response = await asAdmin('patch', `/users/${admin.id}`)
        .send({ role: 'EMPLOYEE' })
        .expect(422)

      expect(response.body.code).toBe('USER_CANNOT_CHANGE_OWN_ROLE')
    })

    it('no deja poner el email de otro usuario interno', async () => {
      await asAdmin('patch', `/users/${employee.id}`)
        .send({ email: 'admin@a.com' })
        .expect(409)
    })
  })

  describe('desactivar y reactivar', () => {
    it('desactivar corta la sesión y el login; reactivar lo devuelve', async () => {
      const employeeToken = await loginAs(app, 'emp@a.com')

      await asAdmin('patch', `/users/${employee.id}/deactivate`).expect(200)

      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(401)
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'emp@a.com', password: TEST_PASSWORD })
        .expect(401)
      // No se borró: sigue en el listado, como inactivo.
      const list = await asAdmin('get', '/users?isActive=false').expect(200)
      expect(list.body.data.data[0].id).toBe(employee.id)

      await asAdmin('patch', `/users/${employee.id}/activate`).expect(200)
      await loginAs(app, 'emp@a.com')
    })

    it('un admin no puede desactivarse a sí mismo', async () => {
      const response = await asAdmin(
        'patch',
        `/users/${admin.id}/deactivate`,
      ).expect(422)

      expect(response.body.code).toBe('USER_CANNOT_DEACTIVATE_SELF')
    })
  })

  describe('reseteo de contraseña', () => {
    it('cambia la contraseña y cierra las sesiones del usuario', async () => {
      const login = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'emp@a.com', password: TEST_PASSWORD })
        .expect(200)

      const response = await asAdmin('patch', `/users/${employee.id}/password`)
        .send({ newPassword: NEW_PASSWORD })
        .expect(200)

      expect(response.body.data.revokedSessions).toBe(1)
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: login.body.data.tokens.refreshToken })
        .expect(401)
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'emp@a.com', password: TEST_PASSWORD })
        .expect(401)
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'emp@a.com', password: NEW_PASSWORD })
        .expect(200)
    })

    it('la propia contraseña no se resetea por acá', async () => {
      const response = await asAdmin('patch', `/users/${admin.id}/password`)
        .send({ newPassword: NEW_PASSWORD })
        .expect(422)

      expect(response.body.code).toBe('USER_CANNOT_RESET_OWN_PASSWORD')
    })
  })

  it('el alta y los cambios quedan en la auditoría, sin el hash', async () => {
    const created = await asAdmin('post', '/users').send(validUser).expect(201)

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: created.body.data.id, action: 'CREATE' },
    })
    expect(log).toMatchObject({ tenantId: tenantA.id, userId: admin.id })
    expect(JSON.stringify(log.changes)).not.toContain('passwordHash')
  })
})
