import { INestApplication } from '@nestjs/common'
import { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/app.module'
import { configureApp } from '../../src/app.setup'
import { TEST_PASSWORD } from './database'

/** Levanta la app completa, configurada igual que en `main.ts`. */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  const app = moduleRef.createNestApplication<NestExpressApplication>()
  configureApp(app as NestExpressApplication)
  await app.init()
  return app
}

/** Loguea al usuario (creado con `createUser`) y devuelve su access token. */
export async function loginAs(
  app: INestApplication,
  email: string,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password: TEST_PASSWORD })
    .expect(200)

  return response.body.data.tokens.accessToken
}

/**
 * Loguea a un propietario o inquilino (creado con `createUser` y rol OWNER o
 * RENTER) por el login de portal, y devuelve su access token.
 */
export async function loginToPortalAs(
  app: INestApplication,
  tenantSlug: string,
  email: string,
  type: 'OWNER' | 'RENTER' = 'OWNER',
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/portal-login')
    .send({ tenantSlug, email, password: TEST_PASSWORD, type })
    .expect(200)

  return response.body.data.tokens.accessToken
}
