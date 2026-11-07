import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ThrottlerModule, ThrottlerModuleOptions } from '@nestjs/throttler'

import { Configuration, ThrottleConfig } from '../../config/configuration'

/** Opciones del módulo, aparte para poder probarlas sin levantar Nest. */
export function throttlerOptions(
  throttle: ThrottleConfig,
): ThrottlerModuleOptions {
  return {
    throttlers: throttle.profiles.map((profile) => ({
      name: profile.name,
      ttl: profile.ttl,
      limit: profile.limit,
    })),
    // Nada se saltea por URL: `includes('/health')` dejaba pasar
    // `/auth/login?x=/health` sin tope (D-249). Las probes usan
    // `@SkipAllThrottles()`.
    skipIf: () => !throttle.enabled,
  }
}

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
 *   const throttle = configService.get('throttle', { infer: true })
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
      useFactory: (configService: ConfigService<Configuration, true>) =>
        throttlerOptions(configService.get('throttle', { infer: true })),
    }),
  ],
  exports: [ThrottlerModule],
})
export class AppThrottlerModule {}
