import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { Payment } from '@/modules/billing/domain/billing'
import {
  NewPayment,
  PageArgs,
  PaymentFilter,
  PaymentRepository,
} from '@/modules/billing/domain/billing.ports'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { paymentToDomain, toDateColumn } from './billing-mappers'

const ORDER = [
  { paidAt: 'desc' },
  { createdAt: 'desc' },
  { id: 'asc' },
] satisfies Prisma.PaymentOrderByWithRelationInput[]

/** Siempre `prisma.db`: tenant y auditoría se aplican solos. */
@Injectable()
export class PaymentRepositoryImpl extends PaymentRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: NewPayment): Promise<Payment> {
    const row = await this.prisma.db.payment.create({
      data: {
        ...data,
        paidAt: toDateColumn(data.paidAt),
        exchangeRateDate: toDateColumn(data.exchangeRateDate),
      } as Prisma.PaymentUncheckedCreateInput,
    })
    return paymentToDomain(row)
  }

  async findById(id: string): Promise<Payment | null> {
    const row = await this.prisma.db.payment.findFirst({ where: { id } })
    return row ? paymentToDomain(row) : null
  }

  async list(
    filter: PaymentFilter,
    page: PageArgs,
  ): Promise<[Payment[], number]> {
    const where = toWhere(filter)
    const [rows, total] = await this.prisma.db.$transaction([
      this.prisma.db.payment.findMany({ where, orderBy: ORDER, ...page }),
      this.prisma.db.payment.count({ where }),
    ])
    return [rows.map(paymentToDomain), total]
  }

  async listAll(filter: PaymentFilter): Promise<Payment[]> {
    const rows = await this.prisma.db.payment.findMany({
      where: toWhere(filter),
      orderBy: ORDER,
    })
    return rows.map(paymentToDomain)
  }

  async confirm(
    id: string,
    data: { confirmedById: string; confirmedAt: Date },
  ): Promise<Payment> {
    const row = await this.prisma.db.payment.update({
      where: { id },
      data: { ...data, status: 'CONFIRMED' },
    })
    return paymentToDomain(row)
  }

  async void(
    id: string,
    data: { voidedById: string; voidedAt: Date; voidReason: string },
  ): Promise<Payment> {
    const row = await this.prisma.db.payment.update({
      where: { id },
      data: { ...data, status: 'VOIDED' },
    })
    return paymentToDomain(row)
  }
}

function toWhere(filter: PaymentFilter): Prisma.PaymentWhereInput {
  return {
    ...(filter.contractId ? { contractId: filter.contractId } : {}),
    ...(filter.renterId ? { renterId: filter.renterId } : {}),
    ...(filter.installmentId ? { installmentId: filter.installmentId } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.receivedBy ? { receivedBy: filter.receivedBy } : {}),
    ...(filter.from || filter.to
      ? {
          paidAt: {
            ...(filter.from ? { gte: toDateColumn(filter.from) } : {}),
            ...(filter.to ? { lte: toDateColumn(filter.to) } : {}),
          },
        }
      : {}),
  }
}
