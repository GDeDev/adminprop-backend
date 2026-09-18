import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

import { createLogger } from '@/shared/logging/root-logger'
import { auditExtension } from './extensions/audit.extension'
import {
  ClientRef,
  softDeleteExtension,
} from './extensions/soft-delete.extension'

const logger = createLogger('Prisma')

/**
 * Cliente de Prisma con las extensiones de soft delete y auditoría aplicadas.
 *
 * El orden importa: **soft delete primero, auditoría después**. Así la
 * auditoría ve el `delete` ya convertido en un `update` sobre `deletedAt` y lo
 * registra como DELETE, en vez de perderlo.
 */
function extendClient(client: PrismaClient) {
  // Las extensiones reciben el cliente explícitamente y no usan `this`: en una
  // extensión de tipo `query`, `this` no es el cliente y el acceso devuelve
  // `undefined` en silencio.
  const ref: ClientRef = { base: client as never }

  const extended = client
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
  /**
   * Cliente con extensiones. **Es el que hay que usar en los repositorios.**
   *
   * `this` (sin extender) queda disponible para los casos que necesitan
   * saltearse el soft delete o la auditoría a propósito: migraciones de datos,
   * limpiezas, el borrado físico de tokens vencidos.
   */
  readonly db: ExtendedPrismaClient

  constructor() {
    super()
    this.db = extendClient(this)
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
