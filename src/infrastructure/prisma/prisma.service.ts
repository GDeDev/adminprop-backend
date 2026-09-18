import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

import { createLogger } from '@/shared/logging/root-logger'
import { auditExtension } from './extensions/audit.extension'
import { softDeleteExtension } from './extensions/soft-delete.extension'

const logger = createLogger('Prisma')

/**
 * Cliente de Prisma con las extensiones de soft delete y auditoría aplicadas.
 *
 * El orden importa: **soft delete primero, auditoría después**. Así la
 * auditoría ve el `delete` ya convertido en un `update` sobre `deletedAt` y lo
 * registra como DELETE, en vez de perderlo.
 */
function extendClient(client: PrismaClient) {
  return client
    .$extends(softDeleteExtension())
    .$extends(auditExtension(client as never))
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
