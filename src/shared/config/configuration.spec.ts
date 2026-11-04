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

  it('usa SITES_SERVER_SECRET, distinto del de revalidación', () => {
    process.env.SITES_SERVER_SECRET = 'secreto-del-throttle'
    process.env.SITES_REVALIDATE_SECRET = 'secreto-de-revalidar'
    delete process.env.SITES_REVALIDATE_URL
    expect(configuration().sites.serverSecret).toBe('secreto-del-throttle')
  })

  it('sin SITES_SERVER_SECRET cae a SITES_REVALIDATE_SECRET (compatibilidad)', () => {
    delete process.env.SITES_SERVER_SECRET
    process.env.SITES_REVALIDATE_SECRET = 'secreto-de-revalidar'
    expect(configuration().sites.serverSecret).toBe('secreto-de-revalidar')
  })

  it('sin ninguno de los dos no hay secreto', () => {
    delete process.env.SITES_SERVER_SECRET
    delete process.env.SITES_REVALIDATE_SECRET
    expect(configuration().sites.serverSecret).toBeNull()
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
