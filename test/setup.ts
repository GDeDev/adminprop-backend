// Setup común a todos los tests (unitarios y e2e).
import 'reflect-metadata'
import { webcrypto } from 'node:crypto'

import { TEST_DATABASE_URL } from './utils/test-database-url'

if (!global.crypto) {
  global.crypto = webcrypto as any
}

beforeEach(() => {
  jest.clearAllMocks()
})

// Entorno mínimo para que pase la validación de `env.validation.ts` cuando un
// test levanta el módulo completo. Son valores descartables, no secretos.
process.env.NODE_ENV = 'test'
// Nunca el DATABASE_URL heredado: ver test/utils/test-database-url.ts.
process.env.DATABASE_URL = TEST_DATABASE_URL
process.env.JWT_ACCESS_SECRET =
  'test-access-secret-descartable-de-al-menos-32-caracteres'
process.env.JWT_REFRESH_SECRET =
  'test-refresh-secret-descartable-de-al-menos-32-caracteres'
// bcrypt con el costo de producción hace que los tests tarden una eternidad.
process.env.BCRYPT_SALT_ROUNDS = '10'
// El rate limiting rompe los tests que hacen muchos requests seguidos.
process.env.THROTTLE_ENABLED = 'false'
