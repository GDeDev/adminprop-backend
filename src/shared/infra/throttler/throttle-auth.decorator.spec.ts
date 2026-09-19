import { ThrottleAuth } from './throttle-auth.decorator'

const THROTTLER_TTL = 'THROTTLER:TTL'
const THROTTLER_LIMIT = 'THROTTLER:LIMIT'

type ThrottleDecorator = () => MethodDecorator & ClassDecorator

/**
 * Aplica un decorador a un método de prueba y devuelve un lector de su
 * metadata.
 *
 * Recibe el decorador por parámetro para poder probar una copia recién
 * importada del módulo (ver el test de resolución diferida).
 */
function decorateWith(decorator: ThrottleDecorator) {
  class Controller {
    handler() {}
  }

  const descriptor = Object.getOwnPropertyDescriptor(
    Controller.prototype,
    'handler',
  )

  if (!descriptor) {
    throw new Error('No se pudo obtener el descriptor del método de prueba')
  }

  decorator()(Controller.prototype, 'handler', descriptor)

  return {
    read: (key: string, profile: string) =>
      Reflect.getMetadata(key + profile, descriptor.value),
  }
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
    const { read } = decorateWith(ThrottleAuth)

    // Si sólo pisara uno, un atacante podría operar bajo la ventana más
    // permisiva de los otros dos.
    for (const profile of ['short', 'medium', 'long']) {
      expect(read(THROTTLER_TTL, profile)).toBeDefined()
      expect(read(THROTTLER_LIMIT, profile)).toBeDefined()
    }
  })

  it('registra resolvers y no valores fijos', () => {
    const { read } = decorateWith(ThrottleAuth)

    // Esto es lo importante: si fueran números, se habrían congelado al
    // importar el módulo, antes de que ConfigModule cargue el .env.
    expect(typeof read(THROTTLER_TTL, 'short')).toBe('function')
    expect(typeof read(THROTTLER_LIMIT, 'short')).toBe('function')
  })

  it('lee el entorno al resolver, no al decorar', async () => {
    jest.resetModules()
    delete process.env.THROTTLE_AUTH_LIMIT

    // Se importa con la variable ausente: un decorador ansioso quedaría en 5.
    const { ThrottleAuth: Fresh } = await import('./throttle-auth.decorator')
    const { read } = decorateWith(Fresh)

    // El .env se carga recién ahora, después de importar el módulo.
    process.env.THROTTLE_AUTH_LIMIT = '3'

    expect(read(THROTTLER_LIMIT, 'short')()).toBe(3)
  })

  it('usa los defaults si la variable falta o es inválida', async () => {
    jest.resetModules()
    delete process.env.THROTTLE_AUTH_TTL
    delete process.env.THROTTLE_AUTH_LIMIT

    const { ThrottleAuth: Fresh } = await import('./throttle-auth.decorator')
    const { read } = decorateWith(Fresh)

    expect(read(THROTTLER_TTL, 'short')()).toBe(60_000) // 1 minuto en ms
    expect(read(THROTTLER_LIMIT, 'short')()).toBe(5)
  })
})
