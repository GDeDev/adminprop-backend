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
