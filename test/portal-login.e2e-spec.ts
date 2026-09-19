import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import bcrypt from 'bcryptjs'
import request from 'supertest'

import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp } from './utils/app'
import {
  createTenant,
  createUser,
  resetDatabase,
  TEST_PASSWORD,
} from './utils/database'

const decodeJwt = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())

/**
 * Login de propietarios e inquilinos (spec Fase 4, 3.2) y la unicidad del
 * email según por dónde entra cada usuario.
 */
describe('Login de portal (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  let tenantA: { id: string }
  let tenantB: { id: string }

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
  })

  const portalLogin = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/v1/auth/portal-login').send(body)

  const internalLogin = (email: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })

  it('un propietario entra por su inmobiliaria y el JWT lo identifica', async () => {
    const owner = await createUser(prisma, {
      tenantId: tenantA.id,
      email: 'paula@mail.com',
      role: Role.OWNER,
    })

    const response = await portalLogin({
      tenantSlug: 'tenant-a',
      email: 'Paula@Mail.com',
      password: TEST_PASSWORD,
      type: 'OWNER',
    }).expect(200)

    expect(response.body.data.user).toMatchObject({
      id: owner.id,
      role: 'OWNER',
      tenantId: tenantA.id,
    })
    const claims = decodeJwt(response.body.data.tokens.accessToken)
    expect(claims).toMatchObject({
      sub: owner.id,
      role: 'OWNER',
      userType: 'owner',
      tenantId: tenantA.id,
    })
  })

  it('mismo email de propietario en dos inmobiliarias: cada login resuelve la suya, sin cruce', async () => {
    const otherPassword = 'OtraClaveDePrueba2'
    const ownerA = await createUser(prisma, {
      tenantId: tenantA.id,
      email: 'dueno@mail.com',
      role: Role.OWNER,
    })
    const ownerB = await createUser(prisma, {
      tenantId: tenantB.id,
      email: 'dueno@mail.com',
      role: Role.OWNER,
      passwordHash: await bcrypt.hash(otherPassword, 4),
    })

    const inA = await portalLogin({
      tenantSlug: 'tenant-a',
      email: 'dueno@mail.com',
      password: TEST_PASSWORD,
      type: 'OWNER',
    }).expect(200)
    const inB = await portalLogin({
      tenantSlug: 'tenant-b',
      email: 'dueno@mail.com',
      password: otherPassword,
      type: 'OWNER',
    }).expect(200)

    expect(inA.body.data.user.id).toBe(ownerA.id)
    expect(inB.body.data.user.id).toBe(ownerB.id)
    expect(decodeJwt(inB.body.data.tokens.accessToken).tenantId).toBe(
      tenantB.id,
    )

    // La contraseña de una no abre la cuenta de la otra.
    await portalLogin({
      tenantSlug: 'tenant-b',
      email: 'dueno@mail.com',
      password: TEST_PASSWORD,
      type: 'OWNER',
    }).expect(401)
  })

  it('la misma persona puede ser propietaria e inquilina: entra por la puerta que elige', async () => {
    const owner = await createUser(prisma, {
      tenantId: tenantA.id,
      email: 'doble@mail.com',
      role: Role.OWNER,
    })
    const renter = await createUser(prisma, {
      tenantId: tenantA.id,
      email: 'doble@mail.com',
      role: Role.RENTER,
    })

    const asRenter = await portalLogin({
      tenantSlug: 'tenant-a',
      email: 'doble@mail.com',
      password: TEST_PASSWORD,
      type: 'RENTER',
    }).expect(200)
    const asOwner = await portalLogin({
      tenantSlug: 'tenant-a',
      email: 'doble@mail.com',
      password: TEST_PASSWORD,
      type: 'OWNER',
    }).expect(200)

    expect(asRenter.body.data.user.id).toBe(renter.id)
    expect(asOwner.body.data.user.id).toBe(owner.id)
  })

  it('inmobiliaria equivocada, inexistente o puerta equivocada: el mismo 401 genérico', async () => {
    await createUser(prisma, {
      tenantId: tenantA.id,
      email: 'paula@mail.com',
      role: Role.OWNER,
    })
    const base = {
      email: 'paula@mail.com',
      password: TEST_PASSWORD,
      type: 'OWNER',
    }

    const wrongTenant = await portalLogin({
      ...base,
      tenantSlug: 'tenant-b',
    }).expect(401)
    const unknownTenant = await portalLogin({
      ...base,
      tenantSlug: 'no-existe',
    }).expect(401)
    const wrongDoor = await portalLogin({
      ...base,
      tenantSlug: 'tenant-a',
      type: 'RENTER',
    }).expect(401)

    for (const response of [wrongTenant, unknownTenant, wrongDoor]) {
      expect(response.body.code).toBe('INVALID_CREDENTIALS')
      expect(response.body.message).toBe(wrongTenant.body.message)
    }
  })

  it('un propietario no entra al backoffice, ni un admin al portal', async () => {
    await createUser(prisma, {
      tenantId: tenantA.id,
      email: 'paula@mail.com',
      role: Role.OWNER,
    })
    await createUser(prisma, {
      tenantId: tenantA.id,
      email: 'admin@a.com',
      role: Role.ADMIN,
    })

    const ownerInBackoffice = await internalLogin('paula@mail.com').expect(401)
    const adminInPortal = await portalLogin({
      tenantSlug: 'tenant-a',
      email: 'admin@a.com',
      password: TEST_PASSWORD,
      type: 'OWNER',
    }).expect(401)

    expect(ownerInBackoffice.body.code).toBe('INVALID_CREDENTIALS')
    expect(adminInPortal.body.code).toBe('INVALID_CREDENTIALS')
  })

  it('valida el cuerpo: slug con formato y tipo de portal conocido', async () => {
    const response = await portalLogin({
      tenantSlug: 'tenant a!',
      email: 'paula@mail.com',
      password: TEST_PASSWORD,
      type: 'ADMIN',
    }).expect(400)

    const fields = response.body.errors.map(
      (error: { field: string }) => error.field,
    )
    expect(fields).toEqual(expect.arrayContaining(['tenantSlug', 'type']))
  })

  describe('unicidad del email en la base', () => {
    it('un email interno no se repite entre inmobiliarias', async () => {
      await createUser(prisma, {
        tenantId: tenantA.id,
        email: 'ana@mail.com',
        role: Role.EMPLOYEE,
      })

      const error = await createUser(prisma, {
        tenantId: tenantB.id,
        email: 'ana@mail.com',
        role: Role.ADMIN,
      }).catch((e) => e)

      expect(error.code).toBe('P2002')
    })

    it('un email de portal no se repite dentro de la misma inmobiliaria y rol', async () => {
      await createUser(prisma, {
        tenantId: tenantA.id,
        email: 'paula@mail.com',
        role: Role.OWNER,
      })

      const error = await createUser(prisma, {
        tenantId: tenantA.id,
        email: 'paula@mail.com',
        role: Role.OWNER,
      }).catch((e) => e)

      expect(error.code).toBe('P2002')
    })

    it('un empleado puede ser además inquilino con el mismo email', async () => {
      await createUser(prisma, {
        tenantId: tenantA.id,
        email: 'ana@mail.com',
        role: Role.EMPLOYEE,
      })

      await expect(
        createUser(prisma, {
          tenantId: tenantA.id,
          email: 'ana@mail.com',
          role: Role.RENTER,
        }),
      ).resolves.toBeDefined()
      await internalLogin('ana@mail.com').expect(200)
    })
  })
})
