import { SkipThrottle } from '@nestjs/throttler'

/**
 * Nombres de los perfiles globales (`configuration.ts`, `throttle.profiles`).
 * `@SkipThrottle()` a secas sólo saltea el perfil `default`, que acá no existe:
 * hay que nombrar cada uno.
 */
export const GLOBAL_THROTTLE_PROFILES = ['short', 'medium', 'long'] as const

/**
 * Saltea los tres perfiles globales en un handler o controller. Sólo para las
 * probes de salud que pega la infraestructura cada pocos segundos: un 429 ahí
 * haría reiniciar el contenedor.
 *
 * Reemplaza al viejo `skipIf` que comparaba la URL con `/health`: con
 * `POST /auth/login?x=/health` cualquiera salteaba todos los topes (D-249).
 */
export const SkipAllThrottles = () =>
  SkipThrottle(
    Object.fromEntries(GLOBAL_THROTTLE_PROFILES.map((name) => [name, true])),
  )
