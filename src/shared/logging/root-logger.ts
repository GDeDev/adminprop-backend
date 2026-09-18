import pino, { Logger, LoggerOptions } from 'pino'

import { configuration } from '../config/configuration'
import { RequestContext } from '../context/request-context'

/**
 * Rutas que pino borra de cada log antes de escribirlo.
 *
 * A diferencia de llamar a `redact()` a mano en cada punto, esto es
 * **declarativo y no se puede olvidar**: se aplica a todo lo que pase por el
 * logger, incluidos los objetos de request y response que pino-http serializa
 * por su cuenta.
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
  '*.password',
  '*.passwordHash',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.apiKey',
]

/** El tipo que devuelve `createLogger`. Alias para no exponer pino en las firmas. */
export type AppLogger = Logger

let rootLogger: Logger | undefined

function buildOptions(): LoggerOptions {
  // Se lee de `configuration()` y no de process.env directo para que la
  // derivación de la config siga viviendo en un solo lugar.
  const { app } = configuration()

  return {
    level: app.logLevel,
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },

    // Cada línea sale con el contexto del request sin que nadie lo propague.
    // Es lo que antes había que pasar a mano, y que en los handlers de CQRS
    // directamente no se podía porque no ven el objeto Request.
    mixin() {
      const context = RequestContext.get()
      if (!context) return {}

      return {
        correlationId: context.correlationId,
        ...(context.userId ? { userId: context.userId } : {}),
      }
    },

    // En desarrollo, legible. En producción, JSON crudo para el agregador.
    transport: app.isProduction
      ? undefined
      : {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            // `context` se muestra en el prefijo del mensaje, así que se lo
            // saca de los campos para no verlo dos veces.
            ignore: 'pid,hostname,context',
            messageFormat: '[{context}] {msg}',
          },
        },
  }
}

/**
 * Instancia raíz de pino, única para todo el proceso.
 *
 * Se construye perezosamente porque depende del entorno ya validado, y el
 * entorno se carga en `main.ts` antes de instanciar Nest.
 */
export function getRootLogger(): Logger {
  if (!rootLogger) rootLogger = pino(buildOptions())
  return rootLogger
}

/**
 * Logger con contexto para una clase.
 *
 * ```ts
 * private readonly logger = createLogger('LoginHandler')
 * this.logger.info({ userId }, 'Login exitoso')
 * ```
 *
 * Ojo con el orden de los argumentos: pino recibe **primero el objeto y después
 * el mensaje**, al revés que el logger de Nest.
 *
 * Es una función y no un provider inyectable a propósito: así se puede usar en
 * clases que no las construye Nest (filtros instanciados a mano, helpers) sin
 * arrastrar el contenedor de DI hasta ahí.
 */
export function createLogger(context: string): AppLogger {
  return getRootLogger().child({ context })
}

/**
 * Vacía el buffer de pino antes de terminar el proceso.
 *
 * pino escribe asíncrono —eso es justamente lo que lo hace rápido— y con un
 * transport corre en un worker thread. Un `process.exit()` no espera a ninguno
 * de los dos, así que sin esto los últimos logs se pierden: exactamente los que
 * necesitás cuando la app no arranca.
 */
export async function flushLogger(timeoutMs = 250): Promise<void> {
  if (!rootLogger) return

  rootLogger.flush()

  // El worker del transport necesita un tick para escribir a stdout.
  await new Promise((resolve) => setTimeout(resolve, timeoutMs))
}

/** Sólo para tests: descarta la instancia para que se reconstruya. */
export function resetRootLogger(): void {
  rootLogger = undefined
}
