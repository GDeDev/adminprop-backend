import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ThrottlerModule } from '@nestjs/throttler'

import { Configuration, ThrottleConfig } from '../../config/configuration'

/**
 * Rate limiting global.
 *
 * Se aplican tres ventanas a la vez, y alcanza con pasarse de una para recibir
 * un 429:
 *
 * | perfil   | por defecto        | para qué                              |
 * |----------|--------------------|---------------------------------------|
 * | `short`  | 10 req / 1 s       | frenar ráfagas                        |
 * | `medium` | 120 req / 1 min    | uso normal sostenido                  |
 * | `long`   | 2000 req / 1 h     | techo por cliente                     |
 *
 * Todo se ajusta por env (`THROTTLE_*`), y `THROTTLE_ENABLED=false` lo apaga
 * entero —útil en los tests e2e—.
 *
 * ## Storage
 *
 * Por defecto el conteo vive en memoria, así el template levanta sin
 * infraestructura extra. Ojo con eso en producción multi-instancia: cada
 * réplica cuenta por separado, así que el límite real es `límite × réplicas`.
 *
 * Para pasar a un conteo compartido:
 *
 * ```bash
 * npm install @nest-lab/throttler-storage-redis ioredis
 * ```
 *
 * ```ts
 * useFactory: (configService: ConfigService<Configuration, true>) => {
 *   const throttle = configService.get<ThrottleConfig>('throttle', { infer: true })
 *   return {
 *     throttlers: throttle.profiles,
 *     storage: new ThrottlerStorageRedisService(process.env.REDIS_URL),
 *   }
 * }
 * ```
 *
 * Nada más cambia: el guard y los decoradores `@Throttle()` siguen igual.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Configuration, true>) => {
        const throttle = configService.get<ThrottleConfig>('throttle', {
          infer: true,
        })

        return {
          throttlers: throttle.profiles.map((profile) => ({
            name: profile.name,
            ttl: profile.ttl,
            limit: profile.limit,
          })),
          // Los health checks no se limitan: los pega Kubernetes cada pocos
          // segundos y un 429 ahí haría reiniciar el pod.
          skipIf: (context) => {
            if (!throttle.enabled) return true

            const request = context.switchToHttp().getRequest()
            const url: string = request?.originalUrl ?? request?.url ?? ''
            return url.includes('/health')
          },
        }
      },
    }),
  ],
  exports: [ThrottlerModule],
})
export class AppThrottlerModule {}
