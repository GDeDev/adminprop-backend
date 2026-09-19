import { INestApplication } from '@nestjs/common'
import request from 'supertest'

import {
  ProvisioningError,
  provisionTenant,
} from '../prisma/lib/tenant-provisioning'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp } from './utils/app'
import { resetDatabase } from './utils/database'

/**
 * Alta de clientes (`npm run tenant:create`) contra Postgres real.
 */
describe('Alta de inmobiliarias (e2e, Postgres)', () => {
  let app: INestApplication
  let prisma: PrismaService

  const provision = (overrides: Record<string, string> = {}) =>
    provisionTenant(prisma, {
      name: 'Inmobiliaria Norte',
      slug: 'norte',
      adminEmail: 'admin@norte.com',
      bcryptSaltRounds: 10,
      ...overrides,
    })

  beforeAll(async () => {
    app = await createTestApp()
    prisma = app.get(PrismaService)
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await resetDatabase(prisma)
  })

  it('crea la inmobiliaria y su admin, y el admin puede loguearse con la contraseña generada', async () => {
    const result = await provision()

    expect(result.generatedPassword).toHaveLength(16)
    const tenant = await prisma.tenant.findUnique({ where: { slug: 'norte' } })
    // Los parámetros de negocio arrancan con los defaults del PRD.
    expect(tenant).toMatchObject({ name: 'Inmobiliaria Norte', isActive: true })
    expect(tenant?.paymentGraceDays).toBe(10)

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@norte.com', password: result.generatedPassword })
      .expect(200)
    expect(login.body.data.user).toMatchObject({
      role: 'ADMIN',
      tenantId: result.tenantId,
    })
  })

  it('la contraseña nunca queda en claro en la base', async () => {
    const result = await provision()

    const admin = await prisma.user.findUnique({
      where: { id: result.adminId },
    })
    expect(admin?.passwordHash).not.toContain(result.generatedPassword)
    expect(admin?.passwordHash).toMatch(/^\$2[aby]\$/)
  })

  it('rechaza un slug repetido sin crear nada', async () => {
    await provision()

    await expect(
      provision({ adminEmail: 'otro@norte.com' }),
    ).rejects.toBeInstanceOf(ProvisioningError)
    expect(await prisma.user.count()).toBe(1)
  })

  it('rechaza un email que ya existe en otra inmobiliaria', async () => {
    // El email es único en todo el sistema: el login no pide inmobiliaria.
    await provision()

    await expect(
      provision({ slug: 'sur', name: 'Inmobiliaria Sur' }),
    ).rejects.toThrow(/Ya existe un usuario/)
    expect(await prisma.tenant.count()).toBe(1)
  })

  it.each(['con espacios', 'guion-al-final-', 'a_b', 'ñandu'])(
    'rechaza el slug "%s"',
    async (slug) => {
      await expect(provision({ slug })).rejects.toThrow(/Slug inválido/)
    },
  )

  it('normaliza el email y el slug', async () => {
    const result = await provision({
      slug: '  Norte ',
      adminEmail: ' Admin@Norte.COM ',
    })

    expect(result).toMatchObject({
      slug: 'norte',
      adminEmail: 'admin@norte.com',
    })
  })
})
