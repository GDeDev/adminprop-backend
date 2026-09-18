import type { StringValue } from 'ms'

import { Environment } from './env.validation'

export interface AppConfig {
  name: string
  env: Environment
  port: number
  isProduction: boolean
  isDevelopment: boolean
  logLevel: string
  swaggerEnabled: boolean
  bodyLimit: string
  trustProxy: boolean
}

export interface DatabaseConfig {
  url: string
}

export interface JwtConfig {
  accessSecret: string
  /** Duración en el formato de `ms`: `"15m"`, `"2 h"`, `"900"`. */
  accessTtl: StringValue
  refreshSecret: string
  refreshTtl: StringValue
  issuer: string
  audience: string
  bcryptSaltRounds: number
  /**
   * Valida el usuario contra la base en cada request. Da revocación inmediata
   * (baneos, cambios de contraseña) a cambio de una consulta por request.
   */
  validateUserOnRequest: boolean
}

export interface AccountLockConfig {
  maxFailedAttempts: number
  /** Duración del bloqueo en milisegundos. */
  lockDurationMs: number
}

export interface ThrottleProfile {
  name: string
  /** Ventana en milisegundos. */
  ttl: number
  limit: number
}

export interface ThrottleConfig {
  enabled: boolean
  profiles: ThrottleProfile[]
  /** Perfil estricto que se aplica a mano sobre los endpoints de auth. */
  auth: { ttl: number; limit: number }
}

export interface CorsConfig {
  origins: string[] | boolean
  credentials: boolean
}

export interface Configuration {
  app: AppConfig
  database: DatabaseConfig
  jwt: JwtConfig
  accountLock: AccountLockConfig
  throttle: ThrottleConfig
  cors: CorsConfig
}

const num = (value: string | undefined, fallback: number): number =>
  value === undefined || value === '' ? fallback : Number(value)

const bool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined || value === ''
    ? fallback
    : ['true', '1', 'yes', 'on'].includes(value.toLowerCase())

const str = (value: string | undefined, fallback: string): string =>
  value === undefined || value === '' ? fallback : value

/**
 * Para las variables sin default, que `env.validation.ts` ya declaró
 * obligatorias.
 *
 * El chequeo es redundante en el camino feliz, y ese es el punto: si alguien
 * agrega una variable obligatoria acá y se olvida de declararla en la
 * validación, falla al arrancar con un mensaje claro en vez de propagar un
 * `undefined` que termina siendo un JWT firmado con secreto vacío.
 */
const required = (value: string | undefined, name: string): string => {
  if (value === undefined || value === '') {
    throw new Error(
      `${name} es obligatoria pero no está definida. ` +
        `Si es nueva, agregala también a EnvironmentVariables en env.validation.ts.`,
    )
  }
  return value
}

function parseCorsOrigins(raw: string | undefined): string[] | boolean {
  if (!raw || raw.trim() === '') return false
  if (raw.trim() === '*') return true
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

/**
 * Convierte el entorno ya validado en un objeto de configuración tipado.
 * Nada del resto de la app debería leer `process.env` directamente: todo pasa
 * por acá vía `ConfigService`.
 */
export function configuration(): Configuration {
  const env = (process.env.NODE_ENV as Environment) ?? Environment.Development
  const isProduction = env === Environment.Production
  const isDevelopment = env === Environment.Development

  return {
    app: {
      name: str(process.env.APP_NAME, 'api'),
      env,
      port: num(process.env.PORT, 3000),
      isProduction,
      isDevelopment,
      logLevel: str(process.env.LOG_LEVEL, isProduction ? 'info' : 'debug'),
      // En producción el Swagger queda apagado salvo que lo pidas explícitamente.
      swaggerEnabled: bool(process.env.SWAGGER_ENABLED, !isProduction),
      bodyLimit: str(process.env.BODY_LIMIT, '1mb'),
      trustProxy: bool(process.env.TRUST_PROXY, isProduction),
    },
    database: {
      url: required(process.env.DATABASE_URL, 'DATABASE_URL'),
    },
    jwt: {
      accessSecret: required(
        process.env.JWT_ACCESS_SECRET,
        'JWT_ACCESS_SECRET',
      ),
      // El cast es seguro: `env.validation.ts` ya verificó contra
      // DURATION_PATTERN que el valor tenga un formato que `ms` entienda.
      // TypeScript no puede deducirlo de una env var, pero el runtime sí lo
      // garantizó antes de llegar hasta acá.
      accessTtl: str(process.env.JWT_ACCESS_TTL, '15m') as StringValue,
      refreshSecret: required(
        process.env.JWT_REFRESH_SECRET,
        'JWT_REFRESH_SECRET',
      ),
      refreshTtl: str(process.env.JWT_REFRESH_TTL, '7d') as StringValue,
      issuer: str(process.env.JWT_ISSUER, str(process.env.APP_NAME, 'api')),
      audience: str(
        process.env.JWT_AUDIENCE,
        str(process.env.APP_NAME, 'api-clients'),
      ),
      bcryptSaltRounds: num(process.env.BCRYPT_SALT_ROUNDS, 12),
      validateUserOnRequest: bool(
        process.env.JWT_VALIDATE_USER_ON_REQUEST,
        false,
      ),
    },
    accountLock: {
      maxFailedAttempts: num(process.env.LOGIN_MAX_FAILED_ATTEMPTS, 5),
      lockDurationMs: num(process.env.LOGIN_LOCK_DURATION_MINUTES, 15) * 60_000,
    },
    throttle: {
      enabled: bool(process.env.THROTTLE_ENABLED, true),
      profiles: [
        {
          name: 'short',
          ttl: num(process.env.THROTTLE_SHORT_TTL, 1) * 1000,
          limit: num(process.env.THROTTLE_SHORT_LIMIT, 10),
        },
        {
          name: 'medium',
          ttl: num(process.env.THROTTLE_MEDIUM_TTL, 60) * 1000,
          limit: num(process.env.THROTTLE_MEDIUM_LIMIT, 120),
        },
        {
          name: 'long',
          ttl: num(process.env.THROTTLE_LONG_TTL, 3600) * 1000,
          limit: num(process.env.THROTTLE_LONG_LIMIT, 2000),
        },
      ],
      auth: {
        ttl: num(process.env.THROTTLE_AUTH_TTL, 900) * 1000,
        limit: num(process.env.THROTTLE_AUTH_LIMIT, 10),
      },
    },
    cors: {
      // Sin CORS_ORIGINS no se habilita ningún origen: hay que optar por él.
      origins: parseCorsOrigins(process.env.CORS_ORIGINS),
      credentials: bool(process.env.CORS_CREDENTIALS, false),
    },
  }
}
