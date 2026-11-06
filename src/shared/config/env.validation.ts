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

/** Desarrollo y tests: los únicos entornos donde se toleran los valores laxos. */
export function isLocalEnvironment(env: Environment): boolean {
  return env === Environment.Development || env === Environment.Test
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
  /** Loguea en vez de enviar. Es el default y el de los tests. */
  Console = 'console',
  /** Resend (Fase 14): necesita RESEND_API_KEY y un dominio verificado. */
  Resend = 'resend',
}

export enum NotificationsProvider {
  /** Loguea en vez de enviar. El único hasta la Fase 14 (Novu + Resend). */
  Console = 'console',
}

/** De dónde salen los índices ICL/IPC (Fase 13, 2.2). */
export enum IndexSourceProvider {
  /** BCRA (ICL) + INDEC vía datos.gob.ar (IPC). Públicas, sin credenciales. */
  BcraIndec = 'bcra-indec',
  /** No busca nada: los índices se cargan a mano. */
  Manual = 'manual',
}

/** Con qué se renderizan los PDFs (Fase 15, A-31). */
export enum PdfProvider {
  /** pdfmake: JS puro, sin Chromium. El único hoy. */
  Pdfmake = 'pdfmake',
}

/** Cómo se redacta la justificación de una tasación (Fase 24, A-60). */
export enum ValuationNarratorProvider {
  /** Plantilla con los números. El default. */
  Template = 'template',
  /** Un modelo de lenguaje redacta a partir de números ya calculados; necesita ANTHROPIC_API_KEY. */
  Llm = 'llm',
}

/** Fuentes de comparables que se pueden activar (Fase 24, 4). */
export const COMPARABLE_SOURCE_NAMES = [
  'fake',
  'zonaprop',
  'argenprop',
  'mercadolibre',
] as const

/** De dónde sale el stock de Tokko para migrar (Fase 21, 4.1). */
export enum TokkoSourceProvider {
  /** Muestra reducida incluida en el código: tests, CI y desarrollo sin red. */
  Fixture = 'fixture',
  /** La API real de Tokko; necesita TOKKO_API_KEY. */
  Http = 'http',
}

/** Con qué se publica en los portales (Fase 23, 6.1). */
export enum ListingPublisherProvider {
  /** Adapter simulado: OAuth con código fijo, sin red ni cuentas. El default. */
  Fake = 'fake',
  /** Mercado Libre real; necesita MERCADOLIBRE_APP_ID, MERCADOLIBRE_CLIENT_SECRET y MERCADOLIBRE_REDIRECT_URI. */
  MercadoLibre = 'mercadolibre',
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

  /** Cada cuánto busca trabajos nuevos cada consumidor. Mínimo 0.5. Default: 2. */
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @Min(0.5)
  QUEUE_POLLING_INTERVAL_SECONDS?: number

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

  /** Remitente de los mails (`notificaciones@dominio`). El nombre visible es el de cada inmobiliaria. */
  @IsOptional()
  @IsString()
  EMAIL_FROM?: string

  /** API key de Resend. Sólo con `EMAIL_PROVIDER=resend`. */
  @IsOptional()
  @IsString()
  RESEND_API_KEY?: string

  /** URL base del portal de propietarios e inquilinos; los mails linkean a `<base>/<slug>`. */
  @IsOptional()
  @IsString()
  PORTAL_BASE_URL?: string

  /** Secreto Svix (`whsec_...`) con el que se firma el webhook de Resend. */
  @IsOptional()
  @IsString()
  RESEND_WEBHOOK_SECRET?: string

  // ------------------------------------------------------------- Notificaciones
  @IsOptional()
  @IsEnum(NotificationsProvider, {
    message: `NOTIFICATIONS_PROVIDER debe ser uno de: ${Object.values(NotificationsProvider).join(', ')}`,
  })
  NOTIFICATIONS_PROVIDER?: NotificationsProvider

  // ---------------------------------------------------------------------- PDFs
  @IsOptional()
  @IsEnum(PdfProvider, {
    message: `PDF_PROVIDER debe ser uno de: ${Object.values(PdfProvider).join(', ')}`,
  })
  PDF_PROVIDER?: PdfProvider

  // ------------------------------------------------------- Migración (Tokko)
  @IsOptional()
  @IsEnum(TokkoSourceProvider, {
    message: `TOKKO_SOURCE debe ser uno de: ${Object.values(TokkoSourceProvider).join(', ')}`,
  })
  TOKKO_SOURCE?: TokkoSourceProvider

  /** API key de Tokko. Sólo con `TOKKO_SOURCE=http`; vive en Doppler. */
  @IsOptional()
  @IsString()
  TOKKO_API_KEY?: string
  // ------------------------------------------------------------ Sitios web
  /**
   * Dominio bajo el que viven los sitios por subdominio (`<sub>.<dominio>`).
   * Sin valor, solo se resuelven dominios propios y el acceso por slug.
   */
  @IsOptional()
  @IsString()
  SITES_BASE_DOMAIN?: string

  /** `https` (default) o `http` (desarrollo con *.lvh.me). */
  @IsOptional()
  @IsString()
  SITES_PROTOCOL?: string

  /**
   * URL de la app de sitios para el acceso por slug (`<url>/_s/<slug>`).
   * Default en desarrollo: http://localhost:3003. En producción, sin valor.
   */
  @IsOptional()
  @IsString()
  SITES_DEV_URL?: string

  /** Hosts https extra desde los que se admiten imágenes (separados por coma). */
  @IsOptional()
  @IsString()
  SITES_ALLOWED_IMAGE_HOSTS?: string

  /**
   * Exige un registro TXT para activar un dominio propio. `false` (solo
   * desarrollo) lo da por verificado al cargarlo. Default: true.
   */
  @toBool()
  @IsOptional()
  @IsBoolean()
  SITES_DOMAIN_VERIFICATION?: boolean

  /** URL base de `apps/sites` para avisarle que un sitio cambió (`/api/revalidate`). */
  @IsOptional()
  @IsString()
  SITES_REVALIDATE_URL?: string

  /**
   * Secreto compartido con `apps/sites` para el aviso de publicación. Si no
   * se define `SITES_SERVER_SECRET`, también hace de secreto del throttle
   * (compatibilidad con despliegues anteriores).
   */
  @IsOptional()
  @IsString()
  SITES_REVALIDATE_SECRET?: string

  /**
   * Secreto con el que `apps/sites` se identifica (header `X-Sites-Secret`)
   * para no contar contra el tope por IP de las lecturas públicas. Distinto del
   * de revalidación; si falta, se usa `SITES_REVALIDATE_SECRET`.
   */
  @IsOptional()
  @IsString()
  SITES_SERVER_SECRET?: string

  /**
   * Secreto de la vista previa del sitio y de la verificación de dominios.
   * **Obligatoria en producción** (32 caracteres o más); fuera de producción hay
   * un valor fijo de desarrollo.
   */
  @IsOptional()
  @IsString()
  SITES_PREVIEW_SECRET?: string

  // ---------------------------------------------------------- Automatizaciones
  @IsOptional()
  @IsEnum(IndexSourceProvider, {
    message: `INDEX_SOURCE_PROVIDER debe ser uno de: ${Object.values(IndexSourceProvider).join(', ')}`,
  })
  INDEX_SOURCE_PROVIDER?: IndexSourceProvider

  /** Apaga el disparo automático de los jobs (los manuales siguen andando). Default: true. */
  @toBool()
  @IsOptional()
  @IsBoolean()
  AUTOMATIONS_ENABLED?: boolean

  // ----------------------------------------------------------------------- Tasación
  /** Lista separada por comas: fake (default), zonaprop, argenprop, mercadolibre. */
  @IsOptional()
  @IsString()
  COMPARABLES_SOURCES?: string

  /** Antigüedad máxima de un aviso para usarlo. Default: 45. */
  @toInt()
  @IsOptional()
  @IsInt()
  @Min(1)
  VALUATION_MAX_AGE_DAYS?: number

  /** Avisos mínimos para tasar. Default: 3. */
  @toInt()
  @IsOptional()
  @IsInt()
  @Min(1)
  VALUATION_MIN_COMPARABLES?: number

  /** Zonas que refresca cada corrida del job. Default: 10. */
  @toInt()
  @IsOptional()
  @IsInt()
  @Min(1)
  VALUATION_ZONES_PER_RUN?: number

  /** Tasaciones por día y por inmobiliaria. Default: 30. */
  @toInt()
  @IsOptional()
  @IsInt()
  @Min(1)
  VALUATION_DAILY_LIMIT?: number

  @IsOptional()
  @IsEnum(ValuationNarratorProvider, {
    message: `VALUATION_NARRATOR debe ser uno de: ${Object.values(ValuationNarratorProvider).join(', ')}`,
  })
  VALUATION_NARRATOR?: ValuationNarratorProvider

  /** Sólo con VALUATION_NARRATOR=llm; vive en Doppler. */
  @IsOptional()
  @IsString()
  ANTHROPIC_API_KEY?: string

  @IsOptional()
  @IsString()
  VALUATION_LLM_MODEL?: string

  /** Contacto que se declara en el User-Agent de los scrapers. */
  @IsOptional()
  @IsString()
  VALUATION_SCRAPER_CONTACT?: string

  // ------------------------------------------------------ CRM y multipublicación
  /** Clave de 32 bytes (64 hex o base64) que cifra los tokens de los portales; vive en Doppler. */
  @IsOptional()
  @IsString()
  APP_ENCRYPTION_KEY?: string

  @IsOptional()
  @IsEnum(ListingPublisherProvider, {
    message: `LISTING_PUBLISHER_PROVIDER debe ser uno de: ${Object.values(ListingPublisherProvider).join(', ')}`,
  })
  LISTING_PUBLISHER_PROVIDER?: ListingPublisherProvider

  /** Base del backoffice (sin barra final) a la que vuelve el OAuth. */
  @IsOptional()
  @IsString()
  BACKOFFICE_BASE_URL?: string

  @IsOptional()
  @IsString()
  MERCADOLIBRE_APP_ID?: string

  @IsOptional()
  @IsString()
  MERCADOLIBRE_CLIENT_SECRET?: string

  @IsOptional()
  @IsString()
  MERCADOLIBRE_REDIRECT_URI?: string

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
    applies: (env) => env.EMAIL_PROVIDER === EmailProvider.Resend,
    provider: 'EMAIL_PROVIDER=resend',
    variables: ['RESEND_API_KEY', 'EMAIL_FROM'],
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

/** Nombres válidos y, en producción, sin la fuente de prueba (Fase 24, auditoría 8.3). */
function assertComparableSources(env: EnvironmentVariables): void {
  if (!env.COMPARABLES_SOURCES) return
  const names = env.COMPARABLES_SOURCES.split(',')
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean)
  const unknown = names.filter(
    (n) => !(COMPARABLE_SOURCE_NAMES as readonly string[]).includes(n),
  )
  if (unknown.length > 0) {
    throw new Error(
      `\n❌ COMPARABLES_SOURCES tiene fuentes desconocidas: ${unknown.join(', ')}. Válidas: ${COMPARABLE_SOURCE_NAMES.join(', ')}.\n`,
    )
  }
  if (env.NODE_ENV === Environment.Production && names.includes('fake')) {
    throw new Error(
      '\n❌ COMPARABLES_SOURCES no puede incluir "fake" en producción: son datos inventados.\n',
    )
  }
}

/**
 * Las únicas variables que no admiten el valor vacío como "no definida": sin
 * ellas la API no puede funcionar y tiene que fallar con un mensaje claro.
 */
const MANDATORY_VARIABLES: readonly string[] = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
]

/**
 * La regla del dueño es crear en Doppler las variables nuevas VACÍAS. Una
 * variable opcional (o con default) en blanco equivale a no definirla; sin esto,
 * un `PORT=""` o un `STORAGE_PROVIDER=""` impedían arrancar. Las obligatorias se
 * dejan tal cual para que sigan fallando. No se relaja nada de seguridad:
 * `SITES_PREVIEW_SECRET` vacía en producción queda como `undefined` y se sigue
 * exigiendo de 32 caracteres o más.
 */
function withoutBlankOptionals(
  config: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).filter(
      ([name, value]) =>
        MANDATORY_VARIABLES.includes(name) ||
        typeof value !== 'string' ||
        value.trim() !== '',
    ),
  )
}

/**
 * Valida `process.env` contra `EnvironmentVariables`.
 * La pasamos a `ConfigModule.forRoot({ validate })`.
 */
/**
 * Prefijo de los secretos de ejemplo de `.env.example`: son públicos (están en
 * el repo), así que firmar con ellos es como no firmar.
 */
const EXAMPLE_SECRET_PREFIX = 'reemplazame'

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  // Sin NODE_ENV la app caía en `development`: un despliegue al que se le
  // olvidó la variable arrancaba con Swagger, secretos de desarrollo y sin las
  // exigencias de producción (D-251). Fuera de jest tiene que ser explícito;
  // los scripts locales lo fijan con `scripts/with-node-env.cjs`.
  const rawNodeEnv = config.NODE_ENV
  if (
    (typeof rawNodeEnv !== 'string' || rawNodeEnv.trim() === '') &&
    !process.env.JEST_WORKER_ID
  ) {
    throw new Error(
      '\n❌ NODE_ENV es obligatoria (development, test, qa o production).\n' +
        'Los scripts de npm la fijan en development; un despliegue tiene que definirla.\n',
    )
  }

  const validated = plainToInstance(
    EnvironmentVariables,
    withoutBlankOptionals(config),
    {
      enableImplicitConversion: false,
      exposeDefaultValues: true,
      excludeExtraneousValues: false,
    },
  )

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
  assertComparableSources(validated)

  // El secreto de la vista previa también firma la prueba de propiedad de los
  // dominios (TXT): sin uno propio y largo fuera de desarrollo y test (qa
  // incluido), quien lea el valor fijo del repo podría fabricar tokens de vista
  // previa y valores de verificación para cualquier inmobiliaria.
  if (!isLocalEnvironment(validated.NODE_ENV)) {
    const preview = validated.SITES_PREVIEW_SECRET ?? ''
    if (preview.length < 32) {
      throw new Error(
        `\n❌ SITES_PREVIEW_SECRET es obligatoria con NODE_ENV=${validated.NODE_ENV} (32 caracteres o más).\n` +
          'Firma los tokens de vista previa del sitio web y los TXT de verificación de dominios: ' +
          'rotarla invalida los dominios que están pendientes de verificar (los ya verificados no se pierden).\n',
      )
    }
  }

  // Antes `*` en producción sólo emitía un warning al arrancar. Con `*` cualquier
  // sitio puede llamar a la API desde el navegador de un usuario.
  if (
    !isLocalEnvironment(validated.NODE_ENV) &&
    (validated.CORS_ORIGINS ?? '')
      .split(',')
      .some((origin) => origin.trim() === '*')
  ) {
    throw new Error(
      `\n❌ CORS_ORIGINS="*" no está permitido con NODE_ENV=${validated.NODE_ENV}.\n` +
        'Listá los orígenes permitidos separados por comas.\n',
    )
  }

  if (validated.NODE_ENV !== Environment.Test) {
    for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (validated[name].toLowerCase().startsWith(EXAMPLE_SECRET_PREFIX)) {
        throw new Error(
          `\n❌ ${name} es el valor de ejemplo de .env.example, que es público.\n` +
            'Generá uno propio con: openssl rand -base64 48\n',
        )
      }
    }
  }

  if (validated.JWT_ACCESS_SECRET === validated.JWT_REFRESH_SECRET) {
    throw new Error(
      '\n❌ JWT_ACCESS_SECRET y JWT_REFRESH_SECRET no pueden ser iguales.\n' +
        'Si comparten secreto, un refresh token sirve como access token.\n',
    )
  }

  return validated
}
