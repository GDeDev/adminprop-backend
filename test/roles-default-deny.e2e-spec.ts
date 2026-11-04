import { INestApplication } from '@nestjs/common'
import { Role } from '@prisma/client'
import request from 'supertest'

import { PrismaService } from '../src/shared/prisma/prisma.service'
import { createTestApp, loginToPortalAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'

const ID = '00000000-0000-4000-8000-000000000000'

/**
 * D-195: un propietario o un inquilino comparten tenant con la inmobiliaria,
 * pero no pueden tocar nada del back office. El `RolesGuard` corre antes que
 * la validación, así que alcanza con pegarle a cada ruta y ver el 403.
 */
const ROUTES: Array<['get' | 'post' | 'patch', string]> = [
  ['get', '/migration/excel/template'],
  ['post', '/migration/excel/analyze'],
  ['post', '/migration/tokko/analyze'],
  ['get', '/migration/batches'],
  ['get', `/migration/batches/${ID}`],
  ['post', `/migration/batches/${ID}/confirm`],
  ['get', `/migration/batches/${ID}/report.xlsx`],
  ['get', '/crm/pipeline'],
  ['get', '/crm/inquiries'],
  ['post', '/crm/inquiries'],
  ['get', `/crm/inquiries/${ID}`],
  ['patch', `/crm/inquiries/${ID}/stage`],
  ['get', '/crm/assignees'],
  ['get', '/crm/analytics/overview'],
  ['get', '/valuation/market-status'],
  ['get', `/valuation/properties/${ID}/history`],
  ['post', `/valuation/properties/${ID}/appraise`],
  ['post', '/valuation/zones/refresh'],
]

describe('RolesGuard cierra por defecto (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  let app: INestApplication
  const tokens: Record<string, string> = {}

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
    const tenant = await createTenant(prisma, 'tenant-a')
    await createUser(prisma, {
      tenantId: tenant.id,
      email: 'owner@a.com',
      role: Role.OWNER,
    })
    await createUser(prisma, {
      tenantId: tenant.id,
      email: 'renter@a.com',
      role: Role.RENTER,
    })
    tokens.OWNER = await loginToPortalAs(
      app,
      'tenant-a',
      'owner@a.com',
      'OWNER',
    )
    tokens.RENTER = await loginToPortalAs(
      app,
      'tenant-a',
      'renter@a.com',
      'RENTER',
    )
  })

  describe.each(['OWNER', 'RENTER'])('un %s', (kind) => {
    it.each(ROUTES)('recibe 403 en %s %s', async (method, url) => {
      await request(app.getHttpServer())
        [method](`/api/v1${url}`)
        .set('Authorization', `Bearer ${tokens[kind]}`)
        .expect(403)
    })
  })
})
