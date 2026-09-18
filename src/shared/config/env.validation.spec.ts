import { Environment, validateEnv } from './env.validation'

const VALID_ENV = {
  NODE_ENV: 'development',
  PORT: '3000',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
}

describe('validateEnv', () => {
  it('acepta un entorno válido y castea los números', () => {
    const result = validateEnv(VALID_ENV)

    expect(result.PORT).toBe(3000)
    expect(typeof result.PORT).toBe('number')
    expect(result.NODE_ENV).toBe(Environment.Development)
  })

  it('falla si falta DATABASE_URL', () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = VALID_ENV

    expect(() => validateEnv(withoutDb)).toThrow(/DATABASE_URL/)
  })

  it('rechaza secretos JWT cortos', () => {
    expect(() =>
      validateEnv({ ...VALID_ENV, JWT_ACCESS_SECRET: 'muy-corto' }),
    ).toThrow(/JWT_ACCESS_SECRET/)
  })

  it('rechaza que access y refresh compartan secreto', () => {
    const shared = 'c'.repeat(40)

    expect(() =>
      validateEnv({
        ...VALID_ENV,
        JWT_ACCESS_SECRET: shared,
        JWT_REFRESH_SECRET: shared,
      }),
    ).toThrow(/no pueden ser iguales/)
  })

  it('rechaza un NODE_ENV desconocido', () => {
    expect(() => validateEnv({ ...VALID_ENV, NODE_ENV: 'prod' })).toThrow(
      /NODE_ENV/,
    )
  })

  it('rechaza un puerto fuera de rango', () => {
    expect(() => validateEnv({ ...VALID_ENV, PORT: '99999' })).toThrow(/PORT/)
  })

  it('rechaza un costo de bcrypt inseguro', () => {
    expect(() =>
      validateEnv({ ...VALID_ENV, BCRYPT_SALT_ROUNDS: '4' }),
    ).toThrow(/BCRYPT_SALT_ROUNDS/)
  })

  it('parsea los booleanos escritos como texto', () => {
    expect(
      validateEnv({ ...VALID_ENV, SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED,
    ).toBe(true)
    expect(
      validateEnv({ ...VALID_ENV, SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED,
    ).toBe(false)
    expect(
      validateEnv({ ...VALID_ENV, SWAGGER_ENABLED: '1' }).SWAGGER_ENABLED,
    ).toBe(true)
  })

  it('junta todos los errores en un solo mensaje', () => {
    // No alcanza con que falle: tiene que reportar las TRES variables faltantes
    // de una, no la primera y listo. Si no, arreglás una, volvés a correr y
    // aparece la siguiente.
    expect(() => validateEnv({ NODE_ENV: 'development' })).toThrow(
      /DATABASE_URL[\s\S]*JWT_ACCESS_SECRET[\s\S]*JWT_REFRESH_SECRET/,
    )
  })
})
