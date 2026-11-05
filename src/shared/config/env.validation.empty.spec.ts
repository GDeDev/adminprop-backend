import { configuration } from './configuration'
import { Environment, validateEnv } from './env.validation'

const VALID_ENV = {
  NODE_ENV: 'development',
  PORT: '3000',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
}

// La regla del dueño es crear en Doppler las variables nuevas VACÍAS. Antes, una
// vacía de enum, PORT o TTL impedía arrancar la API.
describe('validateEnv: variables vacías', () => {
  it.each([
    'QUEUE_PROVIDER',
    'STORAGE_PROVIDER',
    'FEATURE_FLAGS_PROVIDER',
    'EMAIL_PROVIDER',
    'NOTIFICATIONS_PROVIDER',
    'PDF_PROVIDER',
    'INDEX_SOURCE_PROVIDER',
    'LISTING_PUBLISHER_PROVIDER',
    'VALUATION_NARRATOR',
    'TOKKO_SOURCE',
    'SECRETS_PROVIDER',
  ])('un %s vacío se trata como no definido', (name) => {
    const result = validateEnv({ ...VALID_ENV, [name]: '' })
    const value = (result as unknown as Record<string, unknown>)[name]
    expect(value === undefined || value === 'env').toBe(true)
  })

  it('NODE_ENV vacío cae a development y PORT vacío a 3000', () => {
    const result = validateEnv({ ...VALID_ENV, NODE_ENV: '', PORT: '' })
    expect(result.NODE_ENV).toBe(Environment.Development)
    expect(result.PORT).toBe(3000)
  })

  it('los TTL de JWT vacíos no rompen el arranque', () => {
    const result = validateEnv({
      ...VALID_ENV,
      JWT_ACCESS_TTL: '',
      JWT_REFRESH_TTL: '  ',
    })
    expect(result.JWT_ACCESS_TTL).toBeUndefined()
    expect(result.JWT_REFRESH_TTL).toBeUndefined()
  })

  it('los numéricos, booleanos y textos opcionales vacíos se ignoran', () => {
    expect(() =>
      validateEnv({
        ...VALID_ENV,
        BCRYPT_SALT_ROUNDS: '',
        THROTTLE_ENABLED: '',
        CORS_ORIGINS: '',
        LOG_LEVEL: '',
        VALUATION_DAILY_LIMIT: '',
      }),
    ).not.toThrow()
  })

  it('un valor inválido (no vacío) sigue fallando', () => {
    expect(() =>
      validateEnv({ ...VALID_ENV, STORAGE_PROVIDER: 'ftp' }),
    ).toThrow(/STORAGE_PROVIDER/)
    expect(() => validateEnv({ ...VALID_ENV, PORT: 'abc' })).toThrow(/PORT/)
  })

  it.each(['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'])(
    'una obligatoria vacía (%s) sigue fallando con su nombre',
    (name) => {
      expect(() => validateEnv({ ...VALID_ENV, [name]: '' })).toThrow(
        new RegExp(name),
      )
    },
  )

  it('un proveedor vacío no exige sus credenciales', () => {
    expect(() =>
      validateEnv({ ...VALID_ENV, EMAIL_PROVIDER: '', RESEND_API_KEY: '' }),
    ).not.toThrow()
  })

  it('SITES_PREVIEW_SECRET vacía en producción sigue siendo un error', () => {
    const production = { ...VALID_ENV, NODE_ENV: 'production' }
    expect(() =>
      validateEnv({ ...production, SITES_PREVIEW_SECRET: '' }),
    ).toThrow(/SITES_PREVIEW_SECRET/)
    expect(() =>
      validateEnv({ ...production, SITES_PREVIEW_SECRET: '   ' }),
    ).toThrow(/SITES_PREVIEW_SECRET/)
  })

  it('CORS_ORIGINS="*" en producción sigue prohibido y vacío es válido', () => {
    const production = {
      ...VALID_ENV,
      NODE_ENV: 'production',
      SITES_PREVIEW_SECRET: 'p'.repeat(40),
    }
    expect(() => validateEnv({ ...production, CORS_ORIGINS: '*' })).toThrow(
      /CORS_ORIGINS/,
    )
    expect(() => validateEnv({ ...production, CORS_ORIGINS: '' })).not.toThrow()
  })
})

describe('configuration: variables vacías', () => {
  const saved = { ...process.env }

  afterEach(() => {
    process.env = { ...saved }
  })

  it('NODE_ENV, PORT y los proveedores vacíos toman su default', () => {
    process.env.NODE_ENV = ''
    process.env.PORT = ''
    process.env.STORAGE_PROVIDER = ''
    process.env.TOKKO_SOURCE = ''
    process.env.JWT_ACCESS_TTL = ''
    process.env.DATABASE_URL = 'postgresql://x'
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(40)
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(40)
    const config = configuration()
    expect(config.app.port).toBe(3000)
    expect(config.storage.provider).toBe('local')
    expect(config.tokko.source).toBe('fixture')
    expect(config.jwt.accessTtl).toBe('15m')
  })
})
