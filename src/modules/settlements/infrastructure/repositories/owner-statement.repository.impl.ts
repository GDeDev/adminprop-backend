import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import {
  OwnerStatement,
  OwnerStatementTotals,
} from '@/modules/settlements/domain/settlement'
import {
  NewOwnerStatement,
  OwnerStatementChanges,
  OwnerStatementFilter,
  OwnerStatementRepository,
  PageArgs,
} from '@/modules/settlements/domain/settlement.ports'
import { Period } from '@/shared/dates/calendar-date'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { STATEMENT_INCLUDE, statementToDomain } from './settlement-mappers'

const ORDER = [
  { period: 'desc' },
  { createdAt: 'desc' },
  { id: 'asc' },
] satisfies Prisma.OwnerStatementOrderByWithRelationInput[]

/** Siempre `prisma.db`: tenant y auditoría se aplican solos. */
@Injectable()
export class OwnerStatementRepositoryImpl extends OwnerStatementRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: NewOwnerStatement): Promise<OwnerStatement> {
    const row = await this.prisma.db.ownerStatement.create({
      data: data as Prisma.OwnerStatementUncheckedCreateInput,
      include: STATEMENT_INCLUDE,
    })
    return statementToDomain(row)
  }

  async findById(id: string): Promise<OwnerStatement | null> {
    const row = await this.prisma.db.ownerStatement.findFirst({
      where: { id },
      include: STATEMENT_INCLUDE,
    })
    return row ? statementToDomain(row) : null
  }

  async findByOwnerAndPeriod(
    ownerId: string,
    period: Period,
  ): Promise<OwnerStatement | null> {
    const row = await this.prisma.db.ownerStatement.findFirst({
      where: { ownerId, period },
      include: STATEMENT_INCLUDE,
    })
    return row ? statementToDomain(row) : null
  }

  async list(
    filter: OwnerStatementFilter,
    page: PageArgs,
  ): Promise<[OwnerStatement[], number]> {
    const where = toWhere(filter)
    const [rows, total] = await this.prisma.db.$transaction([
      this.prisma.db.ownerStatement.findMany({
        where,
        include: STATEMENT_INCLUDE,
        orderBy: ORDER,
        ...page,
      }),
      this.prisma.db.ownerStatement.count({ where }),
    ])
    return [rows.map(statementToDomain), total]
  }

  async listAll(filter: OwnerStatementFilter): Promise<OwnerStatement[]> {
    const rows = await this.prisma.db.ownerStatement.findMany({
      where: toWhere(filter),
      include: STATEMENT_INCLUDE,
      orderBy: ORDER,
    })
    return rows.map(statementToDomain)
  }

  async count(filter: OwnerStatementFilter): Promise<number> {
    return this.prisma.db.ownerStatement.count({ where: toWhere(filter) })
  }

  async update(
    id: string,
    changes: OwnerStatementChanges,
  ): Promise<OwnerStatement> {
    const row = await this.prisma.db.ownerStatement.update({
      where: { id },
      data: changes,
      include: STATEMENT_INCLUDE,
    })
    return statementToDomain(row)
  }

  async replaceTotals(
    id: string,
    totals: OwnerStatementTotals[],
  ): Promise<void> {
    await this.prisma.db.ownerStatementTotal.deleteMany({
      where: { statementId: id },
    })
    // Una fila por moneda: el `tenantId` lo completa la extensión sólo en
    // altas de primer nivel.
    for (const total of totals) {
      await this.prisma.db.ownerStatementTotal.create({
        data: {
          ...total,
          statementId: id,
        } as Prisma.OwnerStatementTotalUncheckedCreateInput,
      })
    }
  }
}

function toWhere(
  filter: OwnerStatementFilter,
): Prisma.OwnerStatementWhereInput {
  return {
    ...(filter.ownerId ? { ownerId: filter.ownerId } : {}),
    ...(filter.period ? { period: filter.period } : {}),
    ...(filter.status ? { status: filter.status } : {}),
  }
}
