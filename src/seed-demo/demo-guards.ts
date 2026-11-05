/**
 * Guardas del seed de demo: se niega a correr donde podría hacer daño o dejar
 * credenciales publicadas en el repo (la contraseña de demo está en
 * `docs/SEED_DEMO.md`).
 *
 * Son funciones puras, sin leer `process.env` ni conectarse a nada, para
 * poder probarlas. Quien las llama (`main.ts`) les pasa el entorno.
 */

/** Los únicos NODE_ENV donde el seed corre. Sin NODE_ENV se trata como desarrollo. */
const ALLOWED_NODE_ENVS = ['development', 'test']

/** Hosts que significan "esta máquina" o "el Postgres del docker-compose". */
const LOCAL_HOSTS = [
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0.0.0.0',
  'host.docker.internal',
  // Nombre del servicio de Postgres en docker-compose.yml.
  'postgres',
]

/** Si el nombre de la base trae alguno de estos tokens, parece de otro entorno. */
const NON_DEV_DATABASE_TOKEN =
  /(^|[^a-z0-9])(prod|production|prd|live|qa|stg|stage|staging|uat|preprod)([^a-z0-9]|$)/i

export class DemoSeedRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DemoSeedRefusedError'
  }
}

export interface DemoSeedEnvironment {
  nodeEnv: string | undefined
  databaseUrl: string | undefined
}

/**
 * Tira `DemoSeedRefusedError` (con un mensaje que dice qué hacer) si el
 * entorno no es de desarrollo o si la base no parece local.
 */
export function assertDemoSeedAllowed(env: DemoSeedEnvironment): void {
  const nodeEnv = env.nodeEnv?.trim().toLowerCase() ?? ''
  if (nodeEnv !== '' && !ALLOWED_NODE_ENVS.includes(nodeEnv)) {
    throw new DemoSeedRefusedError(
      `El seed de demo sólo corre en desarrollo y NODE_ENV=${env.nodeEnv}. ` +
        'No se creó nada.',
    )
  }

  const rawUrl = env.databaseUrl?.trim()
  if (!rawUrl) {
    throw new DemoSeedRefusedError(
      'Falta DATABASE_URL: sin saber a qué base apunta, el seed no corre. ' +
        'Exportala a mano o corré el script dentro de `doppler run --`.',
    )
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new DemoSeedRefusedError(
      'DATABASE_URL no es una URL válida: el seed no corre sin poder verificar la base.',
    )
  }

  const host = url.hostname.toLowerCase()
  if (!LOCAL_HOSTS.includes(host)) {
    throw new DemoSeedRefusedError(
      `La base no parece local (host "${url.hostname}"). El seed de demo ` +
        'sólo corre contra localhost o el Postgres del docker-compose.',
    )
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!database) {
    throw new DemoSeedRefusedError(
      'DATABASE_URL no indica el nombre de la base.',
    )
  }
  if (NON_DEV_DATABASE_TOKEN.test(database)) {
    throw new DemoSeedRefusedError(
      `La base "${database}" parece de otro entorno (producción, QA o staging). ` +
        'El seed de demo no corre ahí.',
    )
  }
}

/**
 * Variables que el seed fuerza dentro de su propio proceso (no toca tu shell
 * ni Doppler): nada de mails reales, portales de publicación ni Cloudinary. Un seed de demo no debe llegar a ningún servicio externo.
 */
export const DEMO_SEED_FORCED_ENV: Readonly<Record<string, string>> = {
  // Cola real (pg-boss): los cobros dejan efectos de negocio que corren por la
  // cola (borradores de liquidación, cuenta de honorarios, recibos).
  QUEUE_PROVIDER: 'pgboss',
  QUEUE_POLLING_INTERVAL_SECONDS: '0.5',
  AUTOMATIONS_ENABLED: 'false',
  EMAIL_PROVIDER: 'console',
  NOTIFICATIONS_PROVIDER: 'console',
  LISTING_PUBLISHER_PROVIDER: 'fake',
  INDEX_SOURCE_PROVIDER: 'manual',
  STORAGE_PROVIDER: 'local',
  THROTTLE_ENABLED: 'false',
}

/** Aplica `DEMO_SEED_FORCED_ENV` sobre `env` y deja NODE_ENV en development si venía vacío. */
export function applyDemoSeedEnvironment(
  env: Record<string, string | undefined>,
): void {
  Object.assign(env, DEMO_SEED_FORCED_ENV)
  if (!env.NODE_ENV?.trim()) env.NODE_ENV = 'development'
  // El aviso a apps/sites (revalidación) es un POST HTTP a otro servicio.
  delete env.SITES_REVALIDATE_URL
}
