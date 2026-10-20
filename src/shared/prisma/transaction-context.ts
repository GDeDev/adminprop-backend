import { AsyncLocalStorage } from 'node:async_hooks'

const storage = new AsyncLocalStorage<unknown>()

/**
 * Transacción en curso, propagada por `AsyncLocalStorage` como el
 * `RequestContext`.
 *
 * Existe para que un caso de uso que cruza módulos (crear un contrato y
 * marcar la propiedad como alquilada) sea atómico sin pasar el cliente de la
 * transacción por las facades: cada repositorio sigue usando `prisma.db`, y
 * `prisma.db` devuelve el cliente de la transacción abierta si hay una
 * (D-52). Lo abre `PrismaService.transaction()`; nadie más escribe acá.
 */
export const TransactionContext = {
  current<T>(): T | undefined {
    return storage.getStore() as T | undefined
  },

  run<T>(client: unknown, fn: () => Promise<T>): Promise<T> {
    return storage.run(client, fn)
  },
}
