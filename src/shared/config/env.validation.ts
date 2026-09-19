import { plainToInstance, Transform } from 'class-transformer'
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator'

export enum Environment {
  Development = 'development',
  Test = 'test',
  QA = 'qa',
  Production = 'production',
}

export enum QueueProvider {
  /** Cola real sobre Postgres. El default. */
  PgBoss = 'pgboss',
  /** En memoria, sólo para tests unitarios. */
  Memory = 'memory',
}

export enum StorageProvider {
  /** Disco local, servido en /files. Desarrollo y tests. El default. */
  Local = 'local',
  /** Cloudinary: el proveedor del MVP en los entornos desplegados. */
  Cloudinary = 'cloudinary',
}

export enum FeatureFlagsProvider {
  Flagsmith = 'flagsmith',
  /** Flags de FEATURE_FLAGS_ENABLED, prendidos para todos. Tests y desarrollo. */
  Memory = 'memory',
}

export enum EmailProvider {
  /** Loguea en vez de enviar. El único hasta la Fase 14 (Resend vía Novu). */
  Console = 'console',
}

export enum SecretsProvider {
  /** Lee todo de `process.env`, que llena Doppler. */
  Env = 'env',
}

/**
 * Duraciones que entiende la librería `ms`, que es la que usa `jsonwebtoken`
 * para `expiresIn`: o un número pelado de segundos (`"900"`), o número más
 * unidad (`"15m"`, `"2 h"`, `"7d"`).
 *
 * Validarlo acá evita que un `JWT_ACCESS_TTL=banana` pase el arranque y recién
 * explote al firmar el primer token. Además respalda el cast a `StringValue`
 * que hace `configuration()`.
 */
const DURATION_PATTERN =
  /^\d+(\.\d+)?\s*(ms|s|m|h|d|w|y|msec|msecs|millisecond|milliseconds|sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours|day|days|week|weeks|yr|yrs|year|years)?$/i

const toInt = () =>
  Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )

const toBool = () =>
  Transform(({ value }) => {
    if (value === undefined || value === '') return undefined
    if (typeof value === 'boolean') return value
    return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase())
  })

/**
 * Contrato de las variables de entorno. Se valida una sola vez durante el
 * arranque: si falta algo o está mal tipado, el proceso muere ahí mismo en vez
 * de explotar a mitad de un request en producción.
 */
export class EnvironmentVariables {
  // ---------------------------------------------------------------- Aplicación
  @IsEnum(Environment, {
    message: `NODE_ENV debe ser uno de: ${Object.values(Environment).join(', ')}`,
  })
  NODE_ENV: Environment = Environment.Development

  @IsOptional()
  @IsString()
  APP_NAME?: string

  @toInt()
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000

  @IsOptional()
  @IsString()
  LOG_LEVEL?: string

  @toBool()
  @IsOptional()
  @IsBoolean()
  SWAGGER_ENABLED?: boolean

  @IsOptional()
  @IsString()
  BODY_LIMIT?: string

  @IsEnum(SecretsProvider)
  @IsOptional()
  SECRETS_PROVIDER?: SecretsProvider = SecretsProvider.Env

  // ------------------------------------------------------------------ Base de datos
  @IsString()
  @IsNotEmpty({ message: 'DATABASE_URL es obligatoria' })
  DATABASE_URL: string

  // -------------------------------------------------------------------------- JWT
  @IsString()
  @MinLength(32, {
    message:
      'JWT_ACCESS_SECRET debe tener al menos 32 caracteres. Generá uno con: openssl rand -base64 48',
  })
  JWT_ACCESS_SECRET: string

  @IsString()
  @MinLength(32, {
    message:
      'JWT_REFRESH_SECRET debe tener al menos 32 caracteres y ser distinto del de access. Generá uno con: openssl rand -base64 48',
  })
  JWT_REFRESH_SECRET: string

  @IsOptional()
  @IsString()
  @Matches(DURATION_PATTERN, {
    message:
      'JWT_ACCESS_TTL debe ser una duración válida: un número de segundos ("900") o número + unidad ("15m", "2 h", "7d")',
  })
  JWT_ACCESS_TTL?: string

  @IsOptional()
  @IsString()
  @Matches(DURATION_PATTERN, {
    message:
      'JWT_REFRESH_TTL debe ser una duración válida: un número de segundos ("604800") o número + unidad ("7d", "12h")',
  })
  JWT_REFRESH_TTL?: string

  @IsOptional()
  @IsString()
  JWT_ISSUER?: string

  @IsOptional()
  @IsString()
  JWT_AUDIENCE?: string

  @toInt()
  @IsOptional()
  @IsInt()
  @Min(10, { message: 'BCRYPT_SALT_ROUNDS por debajo de 10 es inseguro' })
  @Max(15, {
    message: 'BCRYPT_SALT_ROUNDS por encima de 15 es dolorosamente lento',
  })
  BCRYPT_SALT_ROUNDS?: number

  /**
   * Si está en `true`, cada request valida el usuario contra la base
   * (activo + contraseña no cambiada después de emitir el token). Da revocación
   * inmediata a costa de una consulta por request.
   */
  @toBool()
  @IsOptional()
  @IsBoolean()
  JWT_VALIDATE_USER_ON_REQUEST?: boolean

  // ------------------------------------------------------- Bloqueo de cuentas
  @toInt()
  @IsOptional()
  @IsInt()
  @Min(3)
  LOGIN_MAX_FAILED_ATTEMPTS?: number

  @toInt()
  @IsOptional()
  @IsInt()
  @Min(1)
  LOGIN_LOCK_DURATION_MINUTES?: number

  // --------------------------------------------------------------- Rate limiting
  @toBool()
  @IsOptional()
  @IsBoolean()
  THROTTLE_ENABLED?: boolean

  @toInt()
  @IsOptional()
  @IsInt()
  @Min(1)
  THROTTLE_SHORT_TTL?: number

  @toInt()
  @IsOptional()
  @IsInt()
  @Min(1)
  THROTTLE_SHORT_LIMIT?: number

  @toInt()
  @IsOptional()
  @IsInt()
  @Min(1)
  THROTTLE_MEDIUM_TTL?: number

  @toInt()
  @IsOptional()
  @IsInt()
  @Min(1)
  THROTTLE_MEDIUM_LIMIT?: number

  @toInt()
  @IsOptional()
  @IsInt()
  @Min(1)
  THROTTLE_LONG_TTL?: number

  @toInt()
  @IsOptional()
  @IsInt()
  @Min(1)
  THROTTLE_LONG_LIMIT?: number

  @toInt()
  @IsOptional()
  @IsInt()
  @Min(1)
  THROTTLE_AUTH_TTL?: number

  @toInt()
  @IsOptional()
  @IsInt()
  @Min(1)
  THROTTLE_AUTH_LIMIT?: number

  @toBool()
  @IsOptional()
  @IsBoolean()
  TRUST_PROXY?: boolean

  // ------------------------------------------------------------------------- Cola
  @IsOptional()
  @IsEnum(QueueProvider, {
    message: `QUEUE_PROVIDER debe ser uno de: ${Object.values(QueueProvider).join(', ')}`,
  })
  QUEUE_PROVIDER?: QueueProvider

  // ---------------------------------------------------------------------- Storage
  @IsOptional()
  @IsEnum(StorageProvider, {
    message: `STORAGE_PROVIDER debe ser uno de: ${Object.values(StorageProvider).join(', ')}`,
  })
  STORAGE_PROVIDER?: StorageProvider

  /** Carpeta del adapter local. Default: ./storage-data (en .gitignore). */
  @IsOptional()
  @IsString()
  STORAGE_LOCAL_DIR?: string

  /** Base de las URLs del adapter local. Default: http://localhost:<PORT>. */
  @IsOptional()
  @IsString()
  STORAGE_PUBLIC_BASE_URL?: string

  // Obligatorias sólo con STORAGE_PROVIDER=cloudinary (ver validateEnv).
  @IsOptional()
  @IsString()
  CLOUDINARY_CLOUD_NAME?: string

  @IsOptional()
  @IsString()
  CLOUDINARY_API_KEY?: string

  @IsOptional()
  @IsString()
  CLOUDINARY_API_SECRET?: string

  // ---------------------------------------------------------------- Feature flags
  /**
   * Sin valor: `flagsmith` si hay FLAGSMITH_ENVIRONMENT_KEY, si no `memory`.
   */
  @IsOptional()
  @IsEnum(FeatureFlagsProvider, {
    message: `FEATURE_FLAGS_PROVIDER debe ser uno de: ${Object.values(FeatureFlagsProvider).join(', ')}`,
  })
  FEATURE_FLAGS_PROVIDER?: FeatureFlagsProvider

  /** Server-side key del entorno de Flagsmith. */
  @IsOptional()
  @IsString()
  FLAGSMITH_ENVIRONMENT_KEY?: string

  /** Con el proveedor `memory`: flags prendidos, separados por coma. */
  @IsOptional()
  @IsString()
  FEATURE_FLAGS_ENABLED?: string

  // ------------------------------------------------------------------------ Email
  @IsOptional()
  @IsEnum(EmailProvider, {
    message: `EMAIL_PROVIDER debe ser uno de: ${Object.values(EmailProvider).join(', ')}`,
  })
  EMAIL_PROVIDER?: EmailProvider

  // -------------------------------------------------------------------------- CORS
  /** Lista separada por comas. `*` permite cualquier origen (sólo para desarrollo). */
  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string

  @toBool()
  @IsOptional()
  @IsBoolean()
  CORS_CREDENTIALS?: boolean
}

/**
 * Las credenciales de un proveedor se exigen sólo si ese proveedor está
 * elegido: en desarrollo, con `STORAGE_PROVIDER=local`, no hace falta tener
 * cuenta de Cloudinary para levantar la API.
 */
const PROVIDER_CREDENTIALS: {
  applies: (env: EnvironmentVariables) => boolean
  provider: string
  variables: (keyof EnvironmentVariables)[]
}[] = [
  {
    applies: (env) => env.STORAGE_PROVIDER === StorageProvider.Cloudinary,
    provider: 'STORAGE_PROVIDER=cloudinary',
    variables: [
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
    ],
  },
  {
    applies: (env) =>
      env.FEATURE_FLAGS_PROVIDER === FeatureFlagsProvider.Flagsmith,
    provider: 'FEATURE_FLAGS_PROVIDER=flagsmith',
    variables: ['FLAGSMITH_ENVIRONMENT_KEY'],
  },
]

function assertProviderCredentials(env: EnvironmentVariables): void {
  for (const rule of PROVIDER_CREDENTIALS) {
    if (!rule.applies(env)) continue
    const missing = rule.variables.filter((name) => !env[name])
    if (missing.length > 0) {
      throw new Error(
        `\n❌ Con ${rule.provider} faltan: ${missing.join(', ')}.\n` +
          'Cargalas en Doppler o elegí otro proveedor.\n',
      )
    }
  }
}

/**
 * Valida `process.env` contra `EnvironmentVariables`.
 * La pasamos a `ConfigModule.forRoot({ validate })`.
 */
export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
    exposeDefaultValues: true,
    excludeExtraneousValues: false,
  })

  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: false,
  })

  if (errors.length > 0) {
    const details = errors
      .map((error) => {
        const constraints = Object.values(error.constraints ?? {}).join('; ')
        return `  • ${error.property}: ${constraints || 'valor inválido'}`
      })
      .join('\n')

    throw new Error(
      `\n❌ Configuración de entorno inválida:\n${details}\n\n` +
        `Revisá el config de Doppler y que el proceso corra con "doppler run --".\n` +
        `.env.example lista todas las variables.\n`,
    )
  }

  assertProviderCredentials(validated)

  if (validated.JWT_ACCESS_SECRET === validated.JWT_REFRESH_SECRET) {
    throw new Error(
      '\n❌ JWT_ACCESS_SECRET y JWT_REFRESH_SECRET no pueden ser iguales.\n' +
        'Si comparten secreto, un refresh token sirve como access token.\n',
    )
  }

  return validated
}
