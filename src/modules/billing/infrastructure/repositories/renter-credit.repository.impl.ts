import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import {
  CreditStatus,
  Currency,
  RenterCredit,
} from '@/modules/billing/domain/billing'
import {
  NewRenterCredit,
  RenterCreditChanges,
  RenterCreditRepository,
} from '@/modules/billing/domain/billing.ports'
import { RequestContext } from '@/shared/context/request-context'
import { compareMoney } from '@/shared/money'
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

  async findByOriginPayment(paymentId: string): Promise<RenterCredit | null> {
    const row = await this.prisma.db.renterCredit.findFirst({
      where: { originPaymentId: paymentId },
    })
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

  async lockAvailable(
    renterId: string,
    currency: Currency,
  ): Promise<RenterCredit[]> {
    // SQL directo: Prisma no tiene FOR UPDATE. El tenant va a mano. Mismo
    // orden que listAvailable, así dos transacciones toman los locks en el
    // mismo orden. Postgres reevalúa el estado después de esperar: un saldo
    // que otro dejó APPLIED ya no vuelve.
    const tenantId = requireTenant()
    const rows = await this.prisma.db.$queryRaw<{ id: string }[]>`
      SELECT id FROM renter_credits
      WHERE tenant_id = ${tenantId}::uuid AND renter_id = ${renterId}::uuid
        AND currency = ${currency}::"Currency" AND status = 'AVAILABLE'
      ORDER BY created_at ASC, id ASC
      FOR UPDATE
    `
    if (rows.length === 0) return []
    const found = await this.prisma.db.renterCredit.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return found.map(creditToDomain)
  }

  async lock(id: string): Promise<RenterCredit | null> {
    const tenantId = requireTenant()
    await this.prisma.db.$queryRaw`
      SELECT id FROM renter_credits
      WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
      FOR UPDATE
    `
    return this.findById(id)
  }

  async consume(id: string, amount: string): Promise<RenterCredit | null> {
    const result = await this.prisma.db.renterCredit.updateMany({
      where: { id, status: 'AVAILABLE', remaining: { gte: amount } },
      data: { remaining: { decrement: amount } },
    })
    if (result.count !== 1) return null
    const updated = await this.findById(id)
    if (updated && compareMoney(updated.remaining, '0') === 0) {
      return this.update(id, { status: CreditStatus.APPLIED })
    }
    return updated
  }

  async restore(id: string, amount: string): Promise<RenterCredit> {
    const row = await this.prisma.db.renterCredit.update({
      where: { id },
      data: { remaining: { increment: amount }, status: 'AVAILABLE' },
    })
    return creditToDomain(row)
  }

  async updateIfUntouched(
    id: string,
    expectedRemaining: string,
    changes: RenterCreditChanges,
  ): Promise<boolean> {
    const { refundedAt, ...rest } = changes
    const result = await this.prisma.db.renterCredit.updateMany({
      where: { id, status: 'AVAILABLE', remaining: expectedRemaining },
      data: {
        ...rest,
        ...(refundedAt !== undefined
          ? { refundedAt: toDateColumn(refundedAt) }
          : {}),
      },
    })
    return result.count === 1
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

function requireTenant(): string {
  const tenantId = RequestContext.tenantId
  if (!tenantId)
    throw new Error('Lock de saldo a favor sin tenant en el contexto')
  return tenantId
}
