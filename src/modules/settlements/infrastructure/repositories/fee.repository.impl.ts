import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import {
  FeePayment,
  FeeReceivable,
} from '@/modules/settlements/domain/settlement'
import {
  FeePaymentChanges,
  FeePaymentFilter,
  FeePaymentRepository,
  FeeReceivableChanges,
  FeeReceivableFilter,
  FeeReceivableRepository,
  NewFeePayment,
  NewFeeReceivable,
  PageArgs,
} from '@/modules/settlements/domain/settlement.ports'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  FEE_PAYMENT_INCLUDE,
  feePaymentToDomain,
  receivableToDomain,
  toDateColumn,
} from './settlement-mappers'

/** Siempre `prisma.db`: tenant y auditoría se aplican solos. */
@Injectable()
export class FeeReceivableRepositoryImpl extends FeeReceivableRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async createIfAbsent(data: NewFeeReceivable): Promise<FeeReceivable | null> {
    try {
      const row = await this.prisma.db.feeReceivable.create({
        data: data as Prisma.FeeReceivableUncheckedCreateInput,
      })
      return receivableToDomain(row)
    } catch (error) {
      // P2002: ya hay un receivable con ese pago o esa liquidación de
      // origen (índice único). Es el reintento del listener, no un error.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null
      }
      throw error
    }
  }

  async findById(id: string): Promise<FeeReceivable | null> {
    const row = await this.prisma.db.feeReceivable.findFirst({ where: { id } })
    return row ? receivableToDomain(row) : null
  }

  async findByOriginPayment(paymentId: string): Promise<FeeReceivable | null> {
    const row = await this.prisma.db.feeReceivable.findFirst({
      where: { originPaymentId: paymentId },
    })
    return row ? receivableToDomain(row) : null
  }

  async findByOriginSettlement(
    settlementId: string,
  ): Promise<FeeReceivable | null> {
    const row = await this.prisma.db.feeReceivable.findFirst({
      where: { originSettlementId: settlementId },
    })
    return row ? receivableToDomain(row) : null
  }

  async list(
    filter: FeeReceivableFilter,
    page: PageArgs,
  ): Promise<[FeeReceivable[], number]> {
    const where = toReceivableWhere(filter)
    const [rows, total] = await this.prisma.db.$transaction([
      this.prisma.db.feeReceivable.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...page,
      }),
      this.prisma.db.feeReceivable.count({ where }),
    ])
    return [rows.map(receivableToDomain), total]
  }

  async listAll(filter: FeeReceivableFilter): Promise<FeeReceivable[]> {
    const rows = await this.prisma.db.feeReceivable.findMany({
      where: toReceivableWhere(filter),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return rows.map(receivableToDomain)
  }

  async update(
    id: string,
    changes: FeeReceivableChanges,
  ): Promise<FeeReceivable> {
    const row = await this.prisma.db.feeReceivable.update({
      where: { id },
      data: changes,
    })
    return receivableToDomain(row)
  }
}

function toReceivableWhere(
  filter: FeeReceivableFilter,
): Prisma.FeeReceivableWhereInput {
  return {
    ...(filter.ids ? { id: { in: filter.ids } } : {}),
    ...(filter.ownerId ? { ownerId: filter.ownerId } : {}),
    ...(filter.contractId ? { contractId: filter.contractId } : {}),
    ...(filter.currency ? { currency: filter.currency } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.statuses ? { status: { in: filter.statuses } } : {}),
  }
}

@Injectable()
export class FeePaymentRepositoryImpl extends FeePaymentRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: NewFeePayment): Promise<FeePayment> {
    const { allocations, ...rest } = data
    const created = await this.prisma.db.feePayment.create({
      data: {
        ...rest,
        paidAt: toDateColumn(data.paidAt),
      } as Prisma.FeePaymentUncheckedCreateInput,
    })
    await this.addAllocations(created.id, allocations)
    return this.require(created.id)
  }

  async findById(id: string): Promise<FeePayment | null> {
    const row = await this.prisma.db.feePayment.findFirst({
      where: { id },
      include: FEE_PAYMENT_INCLUDE,
    })
    return row ? feePaymentToDomain(row) : null
  }

  async listAll(
    filter: FeePaymentFilter,
    order: 'oldest' | 'newest' = 'newest',
  ): Promise<FeePayment[]> {
    const direction = order === 'oldest' ? 'asc' : 'desc'
    const rows = await this.prisma.db.feePayment.findMany({
      where: {
        ...(filter.ownerId ? { ownerId: filter.ownerId } : {}),
        ...(filter.contractId ? { contractId: filter.contractId } : {}),
        ...(filter.currency ? { currency: filter.currency } : {}),
        ...(filter.withUnallocated
          ? { voidedAt: null, unallocatedAmount: { gt: 0 } }
          : {}),
        ...(filter.activeOnly ? { voidedAt: null } : {}),
        ...(filter.paidFrom || filter.paidTo
          ? {
              paidAt: {
                ...(filter.paidFrom
                  ? { gte: toDateColumn(filter.paidFrom) }
                  : {}),
                ...(filter.paidTo ? { lte: toDateColumn(filter.paidTo) } : {}),
              },
            }
          : {}),
      },
      include: FEE_PAYMENT_INCLUDE,
      orderBy: [{ paidAt: direction }, { createdAt: direction }, { id: 'asc' }],
    })
    return rows.map(feePaymentToDomain)
  }

  async update(id: string, changes: FeePaymentChanges): Promise<FeePayment> {
    await this.prisma.db.feePayment.update({ where: { id }, data: changes })
    return this.require(id)
  }

  async addAllocations(
    paymentId: string,
    allocations: { feeReceivableId: string; amount: string }[],
  ): Promise<void> {
    // Una fila por imputación: el `tenantId` lo completa la extensión sólo
    // en altas de primer nivel.
    for (const allocation of allocations) {
      await this.prisma.db.feePaymentAllocation.create({
        data: {
          ...allocation,
          feePaymentId: paymentId,
        } as Prisma.FeePaymentAllocationUncheckedCreateInput,
      })
    }
  }

  private async require(id: string): Promise<FeePayment> {
    const row = await this.prisma.db.feePayment.findFirstOrThrow({
      where: { id },
      include: FEE_PAYMENT_INCLUDE,
    })
    return feePaymentToDomain(row)
  }
}
