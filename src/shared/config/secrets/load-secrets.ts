import { EnvSecretsLoader } from './env-secrets.loader'
import { SecretsLoader } from './secrets-loader.interface'

/**
 * Registro de proveedores de secretos disponibles.
 *
 * Para enchufar uno externo:
 *   1. Implementá `SecretsLoader` en este directorio.
 *   2. Sumalo acá con su clave.
 *   3. Agregá la clave al enum `SecretsProvider` de `env.validation.ts`.
 *   4. Levantá la app con `SECRETS_PROVIDER=<clave>`.
 */
const LOADERS: Record<string, () => SecretsLoader> = {
  env: () => new EnvSecretsLoader(),
}

/**
 * Hidrata `process.env` con los secretos del proveedor configurado.
 *
 * Se llama en `main.ts` **antes** de `NestFactory.create()`, así los valores ya
 * están disponibles cuando corre la validación de entorno.
 *
 * Los valores que ya existen en `process.env` no se pisan: un override local
 * siempre gana sobre lo que traiga el proveedor.
 */
export async function loadSecrets(): Promise<void> {
  // A propósito no se lee ningún archivo `.env`: las variables las inyecta
  // Doppler (`doppler run --` en local, su integración nativa en los deploys).
  const providerKey = process.env.SECRETS_PROVIDER ?? 'env'
  const factory = LOADERS[providerKey]

  if (!factory) {
    throw new Error(
      `SECRETS_PROVIDER="${providerKey}" desconocido. Disponibles: ${Object.keys(LOADERS).join(', ')}`,
    )
  }

  const loader = factory()
  const secrets = await loader.load()
  let applied = 0

  for (const [key, value] of Object.entries(secrets)) {
    if (process.env[key] === undefined && value !== undefined) {
      process.env[key] = value
      applied++
    }
  }

  if (applied > 0) {
    // Sólo las claves, nunca los valores.
    console.log(
      `[secrets] ${applied} variable(s) cargadas desde el proveedor "${loader.name}"`,
    )
  }
}
