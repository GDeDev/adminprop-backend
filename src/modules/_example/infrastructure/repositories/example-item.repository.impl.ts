import { Injectable } from '@nestjs/common'
import { ExampleItem as ExampleItemRow, Prisma } from '@prisma/client'

import { ExampleItem } from '@/modules/_example/domain/example-item.entity'
import {
  CreateExampleItemData,
  ExampleItemRepository,
} from '@/modules/_example/domain/example-item.repository'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { toMoneyString } from '@/shared/money'

/**
 * Implementación con Prisma. Siempre `prisma.db`: el cliente con filtro de
 * tenant, soft delete y auditoría. Ningún `where` menciona el tenant.
 */
@Injectable()
export class ExampleItemRepositoryImpl extends ExampleItemRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: CreateExampleItemData): Promise<ExampleItem> {
    // Sin tenantId: lo completa el filtro de tenant. El cast es porque el tipo
    // de Prisma no sabe que la extensión lo agrega.
    const row = await this.prisma.db.exampleItem.create({
      data: {
        name: data.name,
        price: data.price,
      } as Prisma.ExampleItemUncheckedCreateInput,
    })
    return this.toDomain(row)
  }

  async findById(id: string): Promise<ExampleItem | null> {
    const row = await this.prisma.db.exampleItem.findUnique({ where: { id } })
    return row ? this.toDomain(row) : null
  }

  async existsByName(name: string): Promise<boolean> {
    const count = await this.prisma.db.exampleItem.count({ where: { name } })
    return count > 0
  }

  async listIds(): Promise<string[]> {
    const rows = await this.prisma.db.exampleItem.findMany({
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map((row) => row.id)
  }

  count(): Promise<number> {
    return this.prisma.db.exampleItem.count()
  }

  async updatePrice(id: string, price: string): Promise<void> {
    await this.prisma.db.exampleItem.update({
      where: { id },
      data: { price },
    })
  }

  async setAttachment(
    id: string,
    attachment: { key: string; url: string },
  ): Promise<ExampleItem> {
    const row = await this.prisma.db.exampleItem.update({
      where: { id },
      data: { attachmentKey: attachment.key, attachmentUrl: attachment.url },
    })
    return this.toDomain(row)
  }

  /**
   * El `Decimal` de Prisma no sale de acá: se convierte a string con dos
   * decimales, que es como circula el dinero en toda la app.
   */
  private toDomain(row: ExampleItemRow): ExampleItem {
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      price: toMoneyString(row.price),
      attachmentKey: row.attachmentKey,
      attachmentUrl: row.attachmentUrl,
      createdAt: row.createdAt,
    }
  }
}
