import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { Currency, RenterCredit } from '@/modules/billing/domain/billing'
import {
  NewRenterCredit,
  RenterCreditChanges,
  RenterCreditRepository,
} from '@/modules/billing/domain/billing.ports'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { creditToDomain, toDateColumn } from './billing-mappers'

/** Siempre `prisma.db`: tenant y auditoría se aplican solos. */
@Injectable()
export class RenterCreditRepositoryImpl extends RenterCreditRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: NewRenterCredit): Promise<RenterCredit> {
    const row = await this.prisma.db.renterCredit.create({
      data: {
        ...data,
        remaining: data.amount,
      } as Prisma.RenterCreditUncheckedCreateInput,
    })
    return creditToDomain(row)
  }

  async findById(id: string): Promise<RenterCredit | null> {
    const row = await this.prisma.db.renterCredit.findFirst({ where: { id } })
    return row ? creditToDomain(row) : null
  }

  async listAvailable(
    renterId: string,
    currency: Currency,
  ): Promise<RenterCredit[]> {
    const rows = await this.prisma.db.renterCredit.findMany({
      where: { renterId, currency, status: 'AVAILABLE' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return rows.map(creditToDomain)
  }

  async listByRenter(renterId: string): Promise<RenterCredit[]> {
    const rows = await this.prisma.db.renterCredit.findMany({
      where: { renterId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    })
    return rows.map(creditToDomain)
  }

  async listByContract(contractId: string): Promise<RenterCredit[]> {
    const rows = await this.prisma.db.renterCredit.findMany({
      where: { contractId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return rows.map(creditToDomain)
  }

  async update(
    id: string,
    changes: RenterCreditChanges,
  ): Promise<RenterCredit> {
    const { refundedAt, ...rest } = changes
    const row = await this.prisma.db.renterCredit.update({
      where: { id },
      data: {
        ...rest,
        ...(refundedAt !== undefined
          ? { refundedAt: toDateColumn(refundedAt) }
          : {}),
      },
    })
    return creditToDomain(row)
  }
}
