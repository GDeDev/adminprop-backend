/**
 * Cifrado de secretos en reposo (Fase 23, A-84): tokens de portales y, a
 * futuro, cualquier credencial de terceros que se guarde en la base. Clase
 * abstracta para poder usarla como token de inyección.
 */
export abstract class SecretBoxPort {
  /** Devuelve un texto opaco (incluye IV y tag) apto para una columna. */
  abstract seal(plain: string): string

  /** Inversa de `seal`. Tira si el texto fue manipulado o la clave cambió. */
  abstract open(sealed: string): string
}
