import { AsyncLocalStorage } from 'node:async_hooks'

import { Role } from '@/domain/auth/enums/role.enum'

/**
 * Datos del request en curso, accesibles desde cualquier punto de la cadena
 * async sin pasarlos por parámetro.
 */
export interface RequestContextData {
  correlationId: string
  /** Lo completa `JwtAuthGuard`. Ausente en endpoints públicos. */
  userId?: string
  userEmail?: string
  userRole?: Role
  ip?: string
  userAgent?: string
  method?: string
  url?: string
}

const storage = new AsyncLocalStorage<RequestContextData>()

/**
 * Contexto de request basado en `AsyncLocalStorage`.
 *
 * Resuelve dos problemas concretos que teníamos:
 *
 * 1. **Logs sin correlationId.** Antes había que pasarlo a mano en cada llamada
 *    al logger, y en los handlers de CQRS directamente no se podía porque no
 *    tienen acceso al `Request`. Resultado: si un login fallaba, no había forma
 *    de cruzar ese log con el request que lo originó.
 * 2. **Auditoría sin autor.** Un repositorio necesita saber qué usuario está
 *    haciendo el cambio, y pasárselo por parámetro a cada método habría
 *    contaminado todas las firmas del dominio.
 *
 * `AsyncLocalStorage` mantiene el contexto a través de `await`, callbacks y
 * timers, así que funciona en toda la cadena sin que nadie lo propague.
 *
 * Fuera de un request —tareas programadas, scripts, el arranque— devuelve
 * `undefined`. Quien lo use tiene que contemplar ese caso.
 */
export const RequestContext = {
  /** Corre `fn` con el contexto activo. Lo llama el middleware. */
  run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn)
  },

  /** El contexto actual, o `undefined` si estamos fuera de un request. */
  get(): RequestContextData | undefined {
    return storage.getStore()
  },

  get correlationId(): string | undefined {
    return storage.getStore()?.correlationId
  },

  get userId(): string | undefined {
    return storage.getStore()?.userId
  },

  /**
   * Completa datos del usuario una vez que el guard lo autenticó.
   *
   * Muta el objeto del store a propósito: `AsyncLocalStorage.run()` ya arrancó
   * y no se puede reemplazar el store sin abrir un scope nuevo.
   */
  setUser(user: { id: string; email: string; role: Role }): void {
    const store = storage.getStore()
    if (!store) return

    store.userId = user.id
    store.userEmail = user.email
    store.userRole = user.role
  },
}
