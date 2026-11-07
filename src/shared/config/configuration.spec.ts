import { configuration } from './configuration'

describe('configuration: valores por defecto de seguridad', () => {
  const saved = { ...process.env }

  afterEach(() => {
    process.env = { ...saved }
  })

  function swaggerFor(nodeEnv: string, swagger?: string) {
    process.env.NODE_ENV = nodeEnv
    if (swagger === undefined) delete process.env.SWAGGER_ENABLED
    else process.env.SWAGGER_ENABLED = swagger
    return configuration().app.swaggerEnabled
  }

  // Antes sólo producción lo apagaba: un ambiente qa (o uno sin NODE_ENV
  // correcto) publicaba el Swagger sin que nadie lo pidiera.
  it.each(['development', 'test'])('Swagger arranca prendido en %s', (env) => {
    expect(swaggerFor(env)).toBe(true)
  })

  it.each(['qa', 'production'])('Swagger arranca apagado en %s', (env) => {
    expect(swaggerFor(env)).toBe(false)
  })

  it('SWAGGER_ENABLED explícito gana sobre el default', () => {
    expect(swaggerFor('qa', 'true')).toBe(true)
    expect(swaggerFor('development', 'false')).toBe(false)
  })
})

describe('configuration: secreto del throttle de apps/sites', () => {
  const saved = { ...process.env }

  afterEach(() => {
    process.env = { ...saved }
  })

  it('acepta SITES_SERVER_SECRET y también SITES_REVALIDATE_SECRET', () => {
    process.env.SITES_SERVER_SECRET = 'secreto-del-throttle'
    process.env.SITES_REVALIDATE_SECRET = 'secreto-de-revalidar'
    delete process.env.SITES_REVALIDATE_URL
    expect(configuration().sites.serverSecrets).toEqual([
      'secreto-del-throttle',
      'secreto-de-revalidar',
    ])
  })

  it('sin SITES_SERVER_SECRET queda SITES_REVALIDATE_SECRET (compatibilidad)', () => {
    delete process.env.SITES_SERVER_SECRET
    process.env.SITES_REVALIDATE_SECRET = 'secreto-de-revalidar'
    expect(configuration().sites.serverSecrets).toEqual([
      'secreto-de-revalidar',
    ])
  })

  it('sin ninguno de los dos no hay secretos', () => {
    delete process.env.SITES_SERVER_SECRET
    delete process.env.SITES_REVALIDATE_SECRET
    expect(configuration().sites.serverSecrets).toEqual([])
  })

  it('los secretos vacíos no se aceptan', () => {
    process.env.SITES_SERVER_SECRET = ''
    process.env.SITES_REVALIDATE_SECRET = ''
    expect(configuration().sites.serverSecrets).toEqual([])
  })

  it('el aviso de revalidación sigue usando SITES_REVALIDATE_SECRET', () => {
    process.env.SITES_SERVER_SECRET = 'a'
    process.env.SITES_REVALIDATE_SECRET = 'b'
    process.env.SITES_REVALIDATE_URL = 'http://sites/'
    expect(configuration().sites.revalidate).toEqual({
      url: 'http://sites',
      secret: 'b',
    })
  })
})

describe('configuration: vuelta del OAuth al backoffice', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('sin BACKOFFICE_BASE_URL usa el primer origen de CORS_ORIGINS', () => {
    delete process.env.BACKOFFICE_BASE_URL
    process.env.CORS_ORIGINS = 'http://localhost:3001,http://localhost:3002'
    expect(configuration().listings.backofficeBaseUrl).toBe(
      'http://localhost:3001',
    )
    process.env.BACKOFFICE_BASE_URL = 'https://app.ejemplo.com'
    expect(configuration().listings.backofficeBaseUrl).toBe(
      'https://app.ejemplo.com',
    )
  })
})
