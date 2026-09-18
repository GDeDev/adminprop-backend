import { Module } from '@nestjs/common'
import { LoggerModule } from 'nestjs-pino'

import { getRootLogger } from './root-logger'

/** Endpoints que no se loguean: las probes los pegan cada pocos segundos. */
const SILENT_PATHS = ['/health', '/swagger']

/**
 * Logging estructurado con pino.
 *
 * Reemplaza al `CustomLoggerService` hecho a mano. Lo que cambia:
 *
 * - **Un solo formato para toda la app.** Antes los logs propios salían con un
 *   formato y los de Nest (RoutesResolver, InstanceLoader, errores de arranque)
 *   con otro, así que ningún parser del agregador servía para los dos.
 * - **Escritura asíncrona.** `console.log` es síncrono cuando stdout está
 *   redirigido a un archivo o a un pipe, o sea siempre en producción: bajo
 *   carga, loguear se volvía el cuello de botella.
 * - **Redacción declarativa**, en `root-logger.ts`.
 * - **`correlationId` y `userId` automáticos** en cada línea.
 * - **Log de request/response automático**, que antes hacía
 *   `AppLoggerInterceptor` a mano.
 *
 * Comparte la instancia de `getRootLogger()` con el resto de la app para que
 * haya un único stream de salida.
 */
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        logger: getRootLogger(),

        autoLogging: {
          ignore: (req) => {
            const url =
              (req as { originalUrl?: string }).originalUrl ??
              (req as { url?: string }).url ??
              ''
            return SILENT_PATHS.some((path) => url.startsWith(path))
          },
        },

        // Un 4xx es problema del cliente, no una falla del servidor.
        customLogLevel(_req, res, error) {
          if (error || res.statusCode >= 500) return 'error'
          if (res.statusCode >= 400) return 'warn'
          return 'info'
        },

        customProps: () => ({ context: 'HTTP' }),
      },
    }),
  ],
  exports: [LoggerModule],
})
export class AppLoggerModule {}
