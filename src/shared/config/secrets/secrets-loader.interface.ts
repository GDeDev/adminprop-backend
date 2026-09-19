/**
 * Puerto para cargar secretos antes de que arranque la aplicación.
 *
 * Hoy la única implementación es `EnvSecretsLoader`: Doppler inyecta las
 * variables en `process.env` antes de arrancar el proceso, así que no hace
 * falta leer nada. Si algún día se lee un secret manager desde el código (AWS
 * Secrets Manager, Vault), se escribe otra implementación de esta interfaz y se
 * la registra en `loadSecrets()`.
 *
 * El contrato es a propósito "hidratar `process.env`": así el resto de la app
 * no se entera de dónde vino cada valor y la validación de entorno sigue siendo
 * la única puerta de entrada.
 */
export interface SecretsLoader {
  /** Nombre corto, sólo para logs. */
  readonly name: string

  /**
   * Devuelve los secretos a mergear en `process.env`.
   * Los valores ya presentes en el entorno tienen prioridad, para que puedas
   * pisar uno puntual en local sin tocar el proveedor.
   */
  load(): Promise<Record<string, string>>
}
