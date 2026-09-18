import { ThrottleAuth } from './throttle-auth.decorator'

const THROTTLER_TTL = 'THROTTLER:TTL'
const THROTTLER_LIMIT = 'THROTTLER:LIMIT'

/** Aplica @ThrottleAuth() a un método y devuelve la metadata resultante. */
function decorate() {
  class Controller {
    handler() {}
  }

  const descriptor = Object.getOwnPropertyDescriptor(
    Controller.prototype,
    'handler',
  )

  ThrottleAuth()(Controller.prototype, 'handler', descriptor)

  const read = (key: string, profile: string) =>
    Reflect.getMetadata(key + profile, descriptor.value)

  return { read }
}

describe('ThrottleAuth', () => {
  const originalTtl = process.env.THROTTLE_AUTH_TTL
  const originalLimit = process.env.THROTTLE_AUTH_LIMIT

  afterEach(() => {
    process.env.THROTTLE_AUTH_TTL = originalTtl
    process.env.THROTTLE_AUTH_LIMIT = originalLimit
    jest.resetModules()
  })

  it('sobrescribe los tres perfiles globales', () => {
    const { read } = decorate()

    // Si sólo pisara uno, un atacante podría operar bajo la ventana más
    // permisiva de los otros dos.
    for (const profile of ['short', 'medium', 'long']) {
      expect(read(THROTTLER_TTL, profile)).toBeDefined()
      expect(read(THROTTLER_LIMIT, profile)).toBeDefined()
    }
  })

  it('registra resolvers y no valores fijos', () => {
    const { read } = decorate()

    // Esto es lo importante: si fueran números, se habrían congelado al
    // importar el módulo, antes de que ConfigModule cargue el .env.
    expect(typeof read(THROTTLER_TTL, 'short')).toBe('function')
    expect(typeof read(THROTTLER_LIMIT, 'short')).toBe('function')
  })

  it('lee el entorno al resolver, no al decorar', async () => {
    jest.resetModules()
    delete process.env.THROTTLE_AUTH_LIMIT

    // Se importa con la variable ausente: un decorador ansioso quedaría en 10.
    const { ThrottleAuth: Fresh } = await import('./throttle-auth.decorator')

    class Controller {
      handler() {}
    }
    const descriptor = Object.getOwnPropertyDescriptor(
      Controller.prototype,
      'handler',
    )
    Fresh()(Controller.prototype, 'handler', descriptor)

    // El .env se carga recién ahora, después de importar el módulo.
    process.env.THROTTLE_AUTH_LIMIT = '3'

    const limit = Reflect.getMetadata(
      THROTTLER_LIMIT + 'short',
      descriptor.value,
    )
    expect(limit()).toBe(3)
  })

  it('usa los defaults si la variable falta o es inválida', async () => {
    jest.resetModules()
    delete process.env.THROTTLE_AUTH_TTL
    delete process.env.THROTTLE_AUTH_LIMIT

    const { ThrottleAuth: Fresh } = await import('./throttle-auth.decorator')

    class Controller {
      handler() {}
    }
    const descriptor = Object.getOwnPropertyDescriptor(
      Controller.prototype,
      'handler',
    )
    Fresh()(Controller.prototype, 'handler', descriptor)

    const ttl = Reflect.getMetadata(THROTTLER_TTL + 'short', descriptor.value)
    const limit = Reflect.getMetadata(
      THROTTLER_LIMIT + 'short',
      descriptor.value,
    )

    expect(ttl()).toBe(900_000) // 15 minutos en ms
    expect(limit()).toBe(10)
  })
})
