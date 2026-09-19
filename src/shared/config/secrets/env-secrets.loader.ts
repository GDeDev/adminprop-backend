import { SecretsLoader } from './secrets-loader.interface'

/**
 * Proveedor por defecto: no hace nada.
 *
 * Las variables ya vienen de `process.env`: las inyecta Doppler
 * (`doppler run --`) o, en CI y tests, el propio entorno. Existe para que `loadSecrets()` tenga
 * siempre un proveedor válido y el día de mañana cambiar a un secret manager
 * sea reemplazar una línea.
 */
export class EnvSecretsLoader implements SecretsLoader {
  readonly name = 'env'

  async load(): Promise<Record<string, string>> {
    return {}
  }
}
