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

  it('acepta las variables de los sitios web, con el booleano como texto', () => {
    // Doppler y los .env entregan siempre strings: "false" tiene que ser false.
    // Antes SITES_DOMAIN_VERIFICATION=false se rechazaba (faltaba @toBool).
    const result = validateEnv({
      ...VALID_ENV,
      SITES_DOMAIN_VERIFICATION: 'false',
      SITES_BASE_DOMAIN: 'sitios.test',
      SITES_REVALIDATE_URL: 'http://localhost:3003',
      SITES_REVALIDATE_SECRET: 'secreto',
    })

    expect(result.SITES_DOMAIN_VERIFICATION).toBe(false)
    expect(validateEnv(VALID_ENV).SITES_DOMAIN_VERIFICATION).toBeUndefined()
  })

  it('SITES_PREVIEW_SECRET es obligatoria y larga en producción, y opcional afuera', () => {
    const production = { ...VALID_ENV, NODE_ENV: 'production' }

    expect(() => validateEnv(production)).toThrow(/SITES_PREVIEW_SECRET/)
    expect(() =>
      validateEnv({ ...production, SITES_PREVIEW_SECRET: 'corta' }),
    ).toThrow(/SITES_PREVIEW_SECRET/)
    expect(() =>
      validateEnv({ ...production, SITES_PREVIEW_SECRET: 'p'.repeat(40) }),
    ).not.toThrow()
    // Antes qa quedaba con el valor fijo del repo, que es público.
    expect(() => validateEnv({ ...VALID_ENV, NODE_ENV: 'qa' })).toThrow(
      /SITES_PREVIEW_SECRET/,
    )
    // En desarrollo y test alcanza con el valor de desarrollo.
    expect(() => validateEnv(VALID_ENV)).not.toThrow()
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

  describe('credenciales por proveedor', () => {
    it('con storage local no pide credenciales de Cloudinary', () => {
      expect(() =>
        validateEnv({ ...VALID_ENV, STORAGE_PROVIDER: 'local' }),
      ).not.toThrow()
    })

    it('con Cloudinary exige sus tres credenciales y dice cuáles faltan', () => {
      expect(() =>
        validateEnv({
          ...VALID_ENV,
          STORAGE_PROVIDER: 'cloudinary',
          CLOUDINARY_CLOUD_NAME: 'demo',
        }),
      ).toThrow(/CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET/)
    })

    it('rechaza un proveedor desconocido', () => {
      expect(() =>
        validateEnv({ ...VALID_ENV, STORAGE_PROVIDER: 's3' }),
      ).toThrow(/STORAGE_PROVIDER/)
    })
  })

  describe('fuentes de comparables (Fase 24)', () => {
    it('acepta una lista válida', () => {
      expect(() =>
        validateEnv({
          ...VALID_ENV,
          COMPARABLES_SOURCES: 'zonaprop, argenprop',
        }),
      ).not.toThrow()
    })

    it('rechaza una fuente desconocida', () => {
      expect(() =>
        validateEnv({ ...VALID_ENV, COMPARABLES_SOURCES: 'zonaprop,tokko' }),
      ).toThrow(/tokko/)
    })

    it('rechaza la fuente de prueba en producción', () => {
      expect(() =>
        validateEnv({
          ...VALID_ENV,
          NODE_ENV: 'production',
          COMPARABLES_SOURCES: 'fake',
        }),
      ).toThrow(/fake/)
    })
  })

  // Antes sólo se advertía con un log al arrancar y la API quedaba abierta.
  it('rechaza CORS_ORIGINS con * fuera de desarrollo y test', () => {
    const preview = { SITES_PREVIEW_SECRET: 'p'.repeat(40) }
    for (const NODE_ENV of ['production', 'qa']) {
      expect(() =>
        validateEnv({ ...VALID_ENV, ...preview, NODE_ENV, CORS_ORIGINS: '*' }),
      ).toThrow(/CORS_ORIGINS/)
      expect(() =>
        validateEnv({
          ...VALID_ENV,
          ...preview,
          NODE_ENV,
          CORS_ORIGINS: 'https://a.com, *',
        }),
      ).toThrow(/CORS_ORIGINS/)
      expect(() =>
        validateEnv({
          ...VALID_ENV,
          ...preview,
          NODE_ENV,
          CORS_ORIGINS: 'https://a.com,https://b.com',
        }),
      ).not.toThrow()
    }
    expect(() => validateEnv({ ...VALID_ENV, CORS_ORIGINS: '*' })).not.toThrow()
  })
})

describe('validateEnv: NODE_ENV explícito y secretos de ejemplo (D-251)', () => {
  const savedWorker = process.env.JEST_WORKER_ID
  afterEach(() => {
    process.env.JEST_WORKER_ID = savedWorker
  })

  // Antes, sin NODE_ENV la app arrancaba como development (Swagger prendido y
  // sin las exigencias de producción).
  it('fuera de jest, falla si NODE_ENV no está o está vacía', () => {
    delete process.env.JEST_WORKER_ID
    const { NODE_ENV: _omit, ...withoutNodeEnv } = VALID_ENV
    expect(() => validateEnv(withoutNodeEnv)).toThrow(/NODE_ENV es obligatoria/)
    expect(() => validateEnv({ ...VALID_ENV, NODE_ENV: '' })).toThrow(
      /NODE_ENV es obligatoria/,
    )
    expect(() => validateEnv(VALID_ENV)).not.toThrow()
  })

  it('dentro de jest, NODE_ENV puede faltar', () => {
    const { NODE_ENV: _omit, ...withoutNodeEnv } = VALID_ENV
    expect(() => validateEnv(withoutNodeEnv)).not.toThrow()
  })

  // Los de .env.example están en el repo: con ellos cualquiera firma tokens.
  it('rechaza los secretos JWT de ejemplo fuera de test', () => {
    const example = 'REEMPLAZAME_con_openssl_rand_base64_48_minimo_32_chars'
    expect(() =>
      validateEnv({ ...VALID_ENV, JWT_ACCESS_SECRET: example }),
    ).toThrow(/JWT_ACCESS_SECRET es el valor de ejemplo/)
    expect(() =>
      validateEnv({
        ...VALID_ENV,
        NODE_ENV: 'production',
        SITES_PREVIEW_SECRET: 'p'.repeat(40),
        JWT_REFRESH_SECRET: `${example}_otro`,
      }),
    ).toThrow(/JWT_REFRESH_SECRET es el valor de ejemplo/)
    expect(() =>
      validateEnv({
        ...VALID_ENV,
        NODE_ENV: 'test',
        JWT_ACCESS_SECRET: example,
      }),
    ).not.toThrow()
  })
})
