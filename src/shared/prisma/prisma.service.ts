import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

import { createLogger } from '@/shared/logging/root-logger'
import { auditExtension } from './extensions/audit.extension'
import {
  ClientRef,
  softDeleteExtension,
} from './extensions/soft-delete.extension'
import { tenantExtension } from './extensions/tenant.extension'
import { TransactionContext } from './transaction-context'

const logger = createLogger('Prisma')

/**
 * Cliente de Prisma con las extensiones aplicadas.
 *
 * Prisma corre las extensiones en el orden en que se encadenan, y el orden
 * importa:
 *
 * 1. **Tenant**, primero, para que las lecturas internas de las otras dos
 *    (que usan el cliente base) ya reciban el `where` filtrado por tenant.
 * 2. **Soft delete**, para que la auditoría vea el `delete` ya convertido en
 *    un `update` sobre `deletedAt` y lo registre como DELETE.
 * 3. **Auditoría**.
 */
function extendClient(
  client: PrismaClient,
  options: { tenantScoped: boolean },
) {
  // Las extensiones reciben el cliente explícitamente y no usan `this`: en una
  // extensión de tipo `query`, `this` no es el cliente y el acceso devuelve
  // `undefined` en silencio.
  const ref: ClientRef = { base: client as never }

  // El tipo del cliente es el mismo con o sin el filtro de tenant (la extensión
  // sólo tiene hooks de query), así que ambos comparten `ExtendedPrismaClient`.
  const scoped = options.tenantScoped
    ? (client.$extends(tenantExtension()) as unknown as PrismaClient)
    : client

  const extended = scoped
    .$extends(softDeleteExtension(ref))
    .$extends(auditExtension(client as never))

  // Cierra la circularidad: soft-delete necesita el cliente completo para que
  // el `update` en que convierte un `delete` pase también por la auditoría.
  ref.extended = extended as never

  return extended
}

export type ExtendedPrismaClient = ReturnType<typeof extendClient>

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly scopedDb: ExtendedPrismaClient

  /**
   * Cliente con todas las extensiones: filtro de tenant, soft delete y
   * auditoría. **Es el que hay que usar en los repositorios.**
   *
   * Dentro de `transaction()`, devuelve el cliente de esa transacción: así
   * los repositorios participan de ella sin enterarse (D-52). Una lista con
   * `db.$transaction([...])` no se puede abrir adentro de otra: Prisma lo
   * rechaza, y en ese caso hay que hacer las dos consultas por separado.
   *
   * `this` (sin extender) queda disponible para los casos que necesitan
   * saltearse el soft delete o la auditoría a propósito: migraciones de datos,
   * limpiezas, el borrado físico de tokens vencidos.
   */
  get db(): ExtendedPrismaClient {
    return TransactionContext.current<ExtendedPrismaClient>() ?? this.scopedDb
  }

  /**
   * Igual que `db` pero **sin filtro de tenant**. Para las pocas consultas que
   * son entre tenants a propósito y ocurren antes de conocer el tenant: buscar
   * el usuario por email en el login, o por id al rotar un refresh token.
   *
   * Cada uso tiene que poder justificarse en una línea. Si no hay tenant en el
   * contexto por otra razón (un worker, un cron), lo correcto es
   * `RequestContext.runInTenant()`, no este cliente.
   */
  readonly unscoped: ExtendedPrismaClient

  constructor() {
    super()
    this.scopedDb = extendClient(this, { tenantScoped: true })
    this.unscoped = extendClient(this, { tenantScoped: false })
  }

  /**
   * Corre `fn` en una transacción: todo lo que adentro use `prisma.db`
   * —incluidos los repositorios de otros módulos llamados por sus facades—
   * se confirma o se deshace junto. Si ya hay una abierta, se suma a ella.
   *
   * La auditoría escribe fuera de la transacción (con el cliente base), así
   * que un rollback puede dejar filas de historial de cambios que no
   * ocurrieron; quedan visibles en los logs.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (TransactionContext.current()) return fn()
    return this.scopedDb.$transaction((tx) =>
      TransactionContext.run(tx, async () => await fn()),
    )
  }

  async onModuleInit() {
    await this.$connect()
    logger.info('Conectado a la base de datos')
  }

  async onModuleDestroy() {
    await this.$disconnect()
    logger.info('Desconectado de la base de datos')
  }
}
