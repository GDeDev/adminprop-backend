import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import {
  Currency,
  DepositDeductionConcept,
  DepositReturn,
  PaymentMethod,
} from '@/modules/billing/domain/billing'
import {
  DepositReturnRepository,
  NewDepositReturn,
} from '@/modules/billing/domain/billing.ports'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { fromDateColumn, money, toDateColumn } from './billing-mappers'

const INCLUDE = {
  deductions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.DepositReturnInclude

type Row = Prisma.DepositReturnGetPayload<{ include: typeof INCLUDE }>

/** Siempre `prisma.db`: tenant y auditoría se aplican solos. */
@Injectable()
export class DepositReturnRepositoryImpl extends DepositReturnRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: NewDepositReturn): Promise<DepositReturn> {
    const { deductions, ...rest } = data
    const created = await this.prisma.db.depositReturn.create({
      data: {
        ...rest,
        returnedAt: toDateColumn(data.returnedAt),
      } as Prisma.DepositReturnUncheckedCreateInput,
    })
    // Una fila por deducción y no un `createMany`: el `tenantId` lo completa
    // la extensión sólo en altas de primer nivel.
    for (const deduction of deductions) {
      await this.prisma.db.depositReturnDeduction.create({
        data: {
          ...deduction,
          depositReturnId: created.id,
        } as Prisma.DepositReturnDeductionUncheckedCreateInput,
      })
    }
    const row = await this.prisma.db.depositReturn.findFirstOrThrow({
      where: { id: created.id },
      include: INCLUDE,
    })
    return toDomain(row)
  }

  async findByContract(contractId: string): Promise<DepositReturn | null> {
    const row = await this.prisma.db.depositReturn.findFirst({
      where: { contractId },
      include: INCLUDE,
    })
    return row ? toDomain(row) : null
  }
}

function toDomain(row: Row): DepositReturn {
  return {
    id: row.id,
    contractId: row.contractId,
    returnedAt: fromDateColumn(row.returnedAt),
    depositAmount: money(row.depositAmount),
    depositCurrency: Currency[row.depositCurrency],
    returnedAmount: money(row.returnedAmount),
    method: PaymentMethod[row.method],
    notes: row.notes,
    registeredById: row.registeredById,
    deductions: row.deductions.map((d) => ({
      id: d.id,
      concept: DepositDeductionConcept[d.concept],
      description: d.description,
      amount: money(d.amount),
      installmentId: d.installmentId,
      paymentId: d.paymentId,
    })),
    createdAt: row.createdAt,
  }
}
