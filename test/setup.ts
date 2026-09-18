// Setup común a todos los tests (unitarios y e2e).
import 'reflect-metadata'
import { webcrypto } from 'node:crypto'

if (!global.crypto) {
  global.crypto = webcrypto as any
}

beforeEach(() => {
  jest.clearAllMocks()
})

// Entorno mínimo para que pase la validación de `env.validation.ts` cuando un
// test levanta el módulo completo. Son valores descartables, no secretos.
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'mysql://test:test@localhost:3306/test'
process.env.JWT_ACCESS_SECRET =
  'test-access-secret-descartable-de-al-menos-32-caracteres'
process.env.JWT_REFRESH_SECRET =
  'test-refresh-secret-descartable-de-al-menos-32-caracteres'
// bcrypt con el costo de producción hace que los tests tarden una eternidad.
process.env.BCRYPT_SALT_ROUNDS = '10'
// El rate limiting rompe los tests que hacen muchos requests seguidos.
process.env.THROTTLE_ENABLED = 'false'
