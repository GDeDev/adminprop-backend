import { Injectable } from '@nestjs/common'
import { AdvanceExpense as AdvanceExpenseRow, Prisma } from '@prisma/client'

import { AdvanceExpense } from '@/modules/services/domain/advance-expense'
import { Currency } from '@/modules/services/domain/property-service'
import {
  AdvanceExpenseChanges,
  AdvanceExpenseFilter,
  AdvanceExpenseRepository,
  NewAdvanceExpense,
} from '@/modules/services/domain/service.ports'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { fromDateColumn, toDateColumn } from './date-columns'

/** Siempre `prisma.db`: tenant, auditoría y borrado lógico se aplican solos. */
@Injectable()
export class AdvanceExpenseRepositoryImpl extends AdvanceExpenseRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: NewAdvanceExpense): Promise<AdvanceExpense> {
    const row = await this.prisma.db.advanceExpense.create({
      data: {
        ...data,
        expenseDate: toDateColumn(data.expenseDate),
      } as Prisma.AdvanceExpenseUncheckedCreateInput,
    })
    return toDomain(row)
  }

  async findById(id: string): Promise<AdvanceExpense | null> {
    const row = await this.prisma.db.advanceExpense.findFirst({
      where: { id },
    })
    return row ? toDomain(row) : null
  }

  async list(filter: AdvanceExpenseFilter): Promise<AdvanceExpense[]> {
    const rows = await this.prisma.db.advanceExpense.findMany({
      where: {
        contractId: filter.contractId,
        ...(filter.settled === undefined
          ? {}
          : { settlementId: filter.settled ? { not: null } : null }),
      },
      orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    })
    return rows.map(toDomain)
  }

  async update(
    id: string,
    changes: AdvanceExpenseChanges,
  ): Promise<AdvanceExpense> {
    const { expenseDate, ...rest } = changes
    const row = await this.prisma.db.advanceExpense.update({
      where: { id },
      data: {
        ...rest,
        ...(expenseDate !== undefined
          ? { expenseDate: toDateColumn(expenseDate) }
          : {}),
      },
    })
    return toDomain(row)
  }

  async markSettled(
    ids: string[],
    settlementId: string,
    settledAt: Date,
  ): Promise<number> {
    if (ids.length === 0) return 0
    // Sólo los pendientes: uno ya descontado no se reasigna a otra liquidación.
    const result = await this.prisma.db.advanceExpense.updateMany({
      where: { id: { in: ids }, settlementId: null },
      data: { settlementId, settledAt },
    })
    return result.count
  }

  async delete(id: string): Promise<void> {
    await this.prisma.db.advanceExpense.delete({ where: { id } })
  }
}

function toDomain(row: AdvanceExpenseRow): AdvanceExpense {
  return {
    id: row.id,
    contractId: row.contractId,
    renterId: row.renterId,
    amount: row.amount.toFixed(2),
    currency: Currency[row.currency],
    description: row.description,
    expenseDate: fromDateColumn(row.expenseDate),
    receiptKey: row.receiptKey,
    receiptUrl: row.receiptUrl,
    settlementId: row.settlementId,
    settledAt: row.settledAt,
    registeredById: row.registeredById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
