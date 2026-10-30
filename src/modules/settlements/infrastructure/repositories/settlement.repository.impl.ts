import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import {
  Settlement,
  SettlementAdjustment,
  SettlementTransfer,
} from '@/modules/settlements/domain/settlement'
import {
  NewAdjustment,
  NewSettlement,
  NewSettlementExpenseLine,
  NewSettlementPaymentLine,
  NewTransfer,
  PageArgs,
  SettlementChanges,
  SettlementFilter,
  SettlementRepository,
  VoidData,
} from '@/modules/settlements/domain/settlement.ports'
import { Period } from '@/shared/dates/calendar-date'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  adjustmentToDomain,
  SETTLEMENT_INCLUDE,
  settlementToDomain,
  toDateColumn,
  transferToDomain,
} from './settlement-mappers'

const ORDER = [
  { period: 'desc' },
  { sequence: 'desc' },
  { createdAt: 'desc' },
  { id: 'asc' },
] satisfies Prisma.SettlementOrderByWithRelationInput[]

/** Siempre `prisma.db`: tenant y auditoría se aplican solos. */
@Injectable()
export class SettlementRepositoryImpl extends SettlementRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: NewSettlement): Promise<Settlement> {
    const { payments, expenses, ...rest } = data
    const created = await this.prisma.db.settlement.create({
      data: {
        ...rest,
        transferredTotal: '0.00',
      } as Prisma.SettlementUncheckedCreateInput,
    })
    await this.insertLines(created.id, payments, expenses)
    return this.require(created.id)
  }

  async findById(id: string): Promise<Settlement | null> {
    const row = await this.prisma.db.settlement.findFirst({
      where: { id },
      include: SETTLEMENT_INCLUDE,
    })
    return row ? settlementToDomain(row) : null
  }

  async findPendingByContract(contractId: string): Promise<Settlement | null> {
    const row = await this.prisma.db.settlement.findFirst({
      where: { contractId, status: 'PENDING' },
      include: SETTLEMENT_INCLUDE,
    })
    return row ? settlementToDomain(row) : null
  }

  async maxSequence(
    contractId: string,
    period: Period,
  ): Promise<number | null> {
    const result = await this.prisma.db.settlement.aggregate({
      where: { contractId, period },
      _max: { sequence: true },
    })
    return result._max.sequence
  }

  async list(
    filter: SettlementFilter,
    page: PageArgs,
  ): Promise<[Settlement[], number]> {
    const where = toWhere(filter)
    const [rows, total] = await this.prisma.db.$transaction([
      this.prisma.db.settlement.findMany({
        where,
        include: SETTLEMENT_INCLUDE,
        orderBy: ORDER,
        ...page,
      }),
      this.prisma.db.settlement.count({ where }),
    ])
    return [rows.map(settlementToDomain), total]
  }

  async listAll(filter: SettlementFilter): Promise<Settlement[]> {
    const rows = await this.prisma.db.settlement.findMany({
      where: toWhere(filter),
      include: SETTLEMENT_INCLUDE,
      orderBy: ORDER,
    })
    return rows.map(settlementToDomain)
  }

  async update(id: string, changes: SettlementChanges): Promise<Settlement> {
    await this.prisma.db.settlement.update({ where: { id }, data: changes })
    return this.require(id)
  }

  async replaceLines(
    id: string,
    payments: NewSettlementPaymentLine[],
    expenses: NewSettlementExpenseLine[],
  ): Promise<void> {
    await this.prisma.db.settlementPayment.deleteMany({
      where: { settlementId: id },
    })
    await this.prisma.db.settlementExpense.deleteMany({
      where: { settlementId: id },
    })
    await this.insertLines(id, payments, expenses)
  }

  async addAdjustment(
    settlementId: string,
    data: NewAdjustment,
  ): Promise<SettlementAdjustment> {
    const row = await this.prisma.db.settlementAdjustment.create({
      data: {
        ...data,
        settlementId,
      } as Prisma.SettlementAdjustmentUncheckedCreateInput,
    })
    return adjustmentToDomain(row)
  }

  async findAdjustment(id: string): Promise<{
    settlementId: string
    adjustment: SettlementAdjustment
  } | null> {
    const row = await this.prisma.db.settlementAdjustment.findFirst({
      where: { id },
    })
    return row
      ? { settlementId: row.settlementId, adjustment: adjustmentToDomain(row) }
      : null
  }

  async voidAdjustment(id: string, data: VoidData): Promise<void> {
    await this.prisma.db.settlementAdjustment.update({ where: { id }, data })
  }

  async addTransfer(
    settlementId: string,
    data: NewTransfer,
  ): Promise<SettlementTransfer> {
    const row = await this.prisma.db.settlementTransfer.create({
      data: {
        ...data,
        settlementId,
        transferredAt: toDateColumn(data.transferredAt),
      } as Prisma.SettlementTransferUncheckedCreateInput,
    })
    return transferToDomain(row)
  }

  async findTransfer(
    id: string,
  ): Promise<{ settlementId: string; transfer: SettlementTransfer } | null> {
    const row = await this.prisma.db.settlementTransfer.findFirst({
      where: { id },
    })
    return row
      ? { settlementId: row.settlementId, transfer: transferToDomain(row) }
      : null
  }

  async voidTransfer(id: string, data: VoidData): Promise<void> {
    await this.prisma.db.settlementTransfer.update({ where: { id }, data })
  }

  /**
   * Una fila por línea y no un `createMany`: el `tenantId` lo completa la
   * extensión sólo en altas de primer nivel.
   */
  private async insertLines(
    settlementId: string,
    payments: NewSettlementPaymentLine[],
    expenses: NewSettlementExpenseLine[],
  ): Promise<void> {
    for (const line of payments) {
      await this.prisma.db.settlementPayment.create({
        data: {
          ...line,
          settlementId,
          paidAt: toDateColumn(line.paidAt),
        } as Prisma.SettlementPaymentUncheckedCreateInput,
      })
    }
    for (const line of expenses) {
      await this.prisma.db.settlementExpense.create({
        data: {
          ...line,
          settlementId,
          expenseDate: toDateColumn(line.expenseDate),
        } as Prisma.SettlementExpenseUncheckedCreateInput,
      })
    }
  }

  private async require(id: string): Promise<Settlement> {
    const row = await this.prisma.db.settlement.findFirstOrThrow({
      where: { id },
      include: SETTLEMENT_INCLUDE,
    })
    return settlementToDomain(row)
  }
}

function toWhere(filter: SettlementFilter): Prisma.SettlementWhereInput {
  return {
    ...(filter.ids ? { id: { in: filter.ids } } : {}),
    ...(filter.ownerId ? { ownerId: filter.ownerId } : {}),
    ...(filter.propertyId ? { propertyId: filter.propertyId } : {}),
    ...(filter.contractId ? { contractId: filter.contractId } : {}),
    ...(filter.period ? { period: filter.period } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.statuses ? { status: { in: filter.statuses } } : {}),
    ...(filter.statementId !== undefined
      ? { statementId: filter.statementId }
      : {}),
  }
}
