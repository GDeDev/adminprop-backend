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
  ): Promise<Payment | null> {
    // La condición de estado va en el UPDATE y no en una lectura previa: dos
    // confirmaciones a la vez leían las dos "pendiente" y las dos pasaban.
    const row = await updateOrNull(() =>
      this.prisma.db.payment.update({
        where: { id, status: 'PENDING_CONFIRMATION' },
        data: { ...data, status: 'CONFIRMED' },
      }),
    )
    return row ? paymentToDomain(row) : null
  }

  async void(
    id: string,
    data: { voidedById: string; voidedAt: Date; voidReason: string },
  ): Promise<Payment | null> {
    const row = await updateOrNull(() =>
      this.prisma.db.payment.update({
        where: { id, status: { not: 'VOIDED' } },
        data: { ...data, status: 'VOIDED' },
      }),
    )
    return row ? paymentToDomain(row) : null
  }

  async listSettleable(contractId: string): Promise<Payment[]> {
    const rows = await this.prisma.db.payment.findMany({
      where: {
        contractId,
        status: 'CONFIRMED',
        receivedBy: 'AGENCY',
        settlementId: null,
      },
      orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    })
    return rows.map(paymentToDomain)
  }

  async markSettled(ids: string[], settlementId: string): Promise<number> {
    if (ids.length === 0) return 0
    // Sólo los libres: un pago no se liquida dos veces aunque dos
    // liquidaciones lo pidan a la vez.
    const result = await this.prisma.db.payment.updateMany({
      where: { id: { in: ids }, settlementId: null },
      data: { settlementId },
    })
    return result.count
  }

  async unmarkSettled(settlementId: string): Promise<number> {
    const result = await this.prisma.db.payment.updateMany({
      where: { settlementId },
      data: { settlementId: null },
    })
    return result.count
  }

  async assignReceiptNumber(id: string, number: string): Promise<string> {
    const row = await this.prisma.db.payment.update({
      where: { id },
      data: { receiptNumber: number },
    })
    return row.receiptNumber ?? number
  }

  async attachReceiptPdf(
    id: string,
    file: { key: string; url: string },
  ): Promise<void> {
    await this.prisma.db.payment.update({
      where: { id },
      data: { receiptPdfKey: file.key, receiptPdfUrl: file.url },
    })
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

/** `null` cuando el `where` (con la condición de estado) no encontró fila. */
async function updateOrNull<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run()
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      return null
    }
    throw error
  }
}
