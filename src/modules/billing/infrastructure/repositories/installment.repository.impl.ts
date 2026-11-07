import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import {
  Currency,
  Installment,
  InstallmentCharge,
  InstallmentStatus,
  LateFeeAdjustment,
  LateFeeDay,
} from '@/modules/billing/domain/billing'
import {
  InstallmentChanges,
  InstallmentFilter,
  InstallmentRepository,
  NewCharge,
  NewInstallment,
  NewLateFeeAdjustment,
  PageArgs,
  RentPeriodTotal,
} from '@/modules/billing/domain/billing.ports'
import { RequestContext } from '@/shared/context/request-context'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  adjustmentToDomain,
  chargeToDomain,
  INSTALLMENT_INCLUDE,
  installmentToDomain,
  toDateColumn,
} from './billing-mappers'

/** Siempre `prisma.db`: tenant y auditoría se aplican solos. */
@Injectable()
export class InstallmentRepositoryImpl extends InstallmentRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async createIfAbsent(data: NewInstallment): Promise<Installment | null> {
    try {
      const row = await this.prisma.db.installment.create({
        data: {
          ...data,
          graceEndDate: toDateColumn(data.graceEndDate),
        } as Prisma.InstallmentUncheckedCreateInput,
        include: INSTALLMENT_INCLUDE,
      })
      return installmentToDomain(row)
    } catch (error) {
      // P2002: ya existe la cuota de ese contrato y mes (índice único). Es el
      // camino normal de la segunda corrida, no un error.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null
      }
      throw error
    }
  }

  async findById(id: string): Promise<Installment | null> {
    const row = await this.prisma.db.installment.findFirst({
      where: { id },
      include: INSTALLMENT_INCLUDE,
    })
    return row ? installmentToDomain(row) : null
  }

  async deleteIfUntouched(id: string): Promise<boolean> {
    const result = await this.prisma.db.installment.deleteMany({
      where: {
        id,
        payments: { none: {} },
        charges: { none: {} },
        adjustments: { none: {} },
      },
    })
    return result.count === 1
  }

  async lockForUpdate(id: string): Promise<void> {
    // SQL directo: Prisma no tiene FOR UPDATE. El tenant se filtra a mano
    // porque el SQL crudo no pasa por la extensión de tenant.
    const tenantId = RequestContext.tenantId
    if (!tenantId) throw new Error('Lock de cuota sin tenant en el contexto')
    await this.prisma.db.$queryRaw`
      SELECT id FROM installments
      WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
      FOR UPDATE
    `
  }

  async rentTotalsByPeriod(
    periodFrom: string,
    periodTo: string,
  ): Promise<RentPeriodTotal[]> {
    const tenantId = RequestContext.tenantId
    if (!tenantId)
      throw new Error('Totales de alquiler sin tenant en el contexto')
    // SQL directo: Prisma no agrupa por una columna de la cuota sumando
    // columnas de sus pagos. Los pagos se suman primero por cuota y recién
    // después se unen, para que la suma de las cuotas no se multiplique por la
    // cantidad de pagos. `numeric` sale como texto: ningún monto pasa por
    // `number`. "Vigente" es lo mismo que `activePayments`: todo menos anulado.
    const rows = await this.prisma.db.$queryRaw<
      {
        period: string
        currency: string
        base_amount: string
        rent_paid: string
      }[]
    >`
      SELECT i.period,
             i.currency::text AS currency,
             SUM(i.base_amount)::text AS base_amount,
             COALESCE(SUM(p.rent), 0)::text AS rent_paid
      FROM installments i
      LEFT JOIN (
        SELECT installment_id, SUM(rent_applied) AS rent
        FROM payments
        WHERE tenant_id = ${tenantId}::uuid AND status <> 'VOIDED'
        GROUP BY installment_id
      ) p ON p.installment_id = i.id
      WHERE i.tenant_id = ${tenantId}::uuid
        AND i.period >= ${periodFrom} AND i.period <= ${periodTo}
      GROUP BY i.period, i.currency
      ORDER BY i.period, i.currency
    `
    return rows.map((row) => ({
      period: row.period,
      currency: Currency[row.currency as keyof typeof Currency],
      baseAmount: row.base_amount,
      rentPaid: row.rent_paid,
    }))
  }

  async list(
    filter: InstallmentFilter,
    page: PageArgs,
  ): Promise<[Installment[], number]> {
    const where = toWhere(filter)
    const [rows, total] = await this.prisma.db.$transaction([
      this.prisma.db.installment.findMany({
        where,
        include: INSTALLMENT_INCLUDE,
        orderBy: [{ period: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        ...page,
      }),
      this.prisma.db.installment.count({ where }),
    ])
    return [rows.map(installmentToDomain), total]
  }

  async listAll(filter: InstallmentFilter): Promise<Installment[]> {
    const rows = await this.prisma.db.installment.findMany({
      where: toWhere(filter),
      include: INSTALLMENT_INCLUDE,
      orderBy: [{ period: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    })
    return rows.map(installmentToDomain)
  }

  async update(id: string, changes: InstallmentChanges): Promise<Installment> {
    const { paidAt, ...rest } = changes
    const row = await this.prisma.db.installment.update({
      where: { id },
      data: {
        ...rest,
        ...(paidAt !== undefined ? { paidAt: toDateColumn(paidAt) } : {}),
      },
      include: INSTALLMENT_INCLUDE,
    })
    return installmentToDomain(row)
  }

  async replaceFeeDays(
    installmentId: string,
    days: LateFeeDay[],
  ): Promise<void> {
    await this.prisma.db.installmentLateFeeDay.deleteMany({
      where: { installmentId },
    })
    if (days.length === 0) return
    // Un solo INSERT (B-P5): antes era uno por día dentro de la transacción del
    // pago. `createMany` es un alta de primer nivel, así que la extensión de
    // tenant igual completa y valida el `tenantId` de cada fila; va explícito
    // para que el tipo `Unchecked` no dependa de eso.
    const tenantId = RequestContext.tenantId
    if (!tenantId) throw new Error('replaceFeeDays sin tenant en el contexto')
    await this.prisma.db.installmentLateFeeDay.createMany({
      data: days.map((day): Prisma.InstallmentLateFeeDayCreateManyInput => ({
        tenantId,
        installmentId,
        day: toDateColumn(day.day),
        dayNumber: day.dayNumber,
        outstandingBase: day.outstandingBase,
        dailyPercentage: day.dailyPercentage,
        amount: day.amount,
      })),
    })
  }

  async addCharge(
    installmentId: string,
    data: NewCharge,
  ): Promise<InstallmentCharge> {
    const row = await this.prisma.db.installmentCharge.create({
      data: {
        ...data,
        installmentId,
      } as Prisma.InstallmentChargeUncheckedCreateInput,
    })
    return chargeToDomain(row)
  }

  async findCharge(id: string): Promise<InstallmentCharge | null> {
    const row = await this.prisma.db.installmentCharge.findFirst({
      where: { id },
    })
    return row ? chargeToDomain(row) : null
  }

  async voidCharge(
    id: string,
    data: { voidedById: string; voidedAt: Date; voidReason: string },
  ): Promise<InstallmentCharge> {
    const row = await this.prisma.db.installmentCharge.update({
      where: { id },
      data,
    })
    return chargeToDomain(row)
  }

  async addAdjustment(
    installmentId: string,
    data: NewLateFeeAdjustment,
  ): Promise<LateFeeAdjustment> {
    const row = await this.prisma.db.lateFeeAdjustment.create({
      data: {
        ...data,
        installmentId,
      } as Prisma.LateFeeAdjustmentUncheckedCreateInput,
    })
    return adjustmentToDomain(row)
  }
}

/**
 * `OVERDUE` no se guarda (D-71): se traduce a "no saldada y gracia vencida".
 * `PENDING`/`PARTIAL` excluyen las vencidas, para que los cuatro filtros
 * partan el listado sin superponerse.
 */
function toWhere(filter: InstallmentFilter): Prisma.InstallmentWhereInput {
  const where: Prisma.InstallmentWhereInput = {
    ...(filter.ids ? { id: { in: filter.ids } } : {}),
    ...(filter.period ? { period: filter.period } : {}),
    ...(filter.periodFrom || filter.periodTo
      ? {
          period: {
            ...(filter.periodFrom ? { gte: filter.periodFrom } : {}),
            ...(filter.periodTo ? { lte: filter.periodTo } : {}),
          },
        }
      : {}),
    ...(filter.contractId ? { contractId: filter.contractId } : {}),
    ...(filter.renterId ? { renterId: filter.renterId } : {}),
    ...(filter.renterIds ? { renterId: { in: filter.renterIds } } : {}),
    ...(filter.propertyId ? { propertyId: filter.propertyId } : {}),
    ...(filter.ownerId ? { ownerId: filter.ownerId } : {}),
    ...(filter.collectionMode ? { collectionMode: filter.collectionMode } : {}),
  }
  if (filter.status === InstallmentStatus.OVERDUE) {
    where.status = { not: InstallmentStatus.PAID }
    if (filter.unpaidGraceEndBefore) {
      where.graceEndDate = { lt: toDateColumn(filter.unpaidGraceEndBefore) }
    }
  } else if (filter.status) {
    where.status = filter.status
    if (filter.status !== InstallmentStatus.PAID && filter.graceEndFrom) {
      where.graceEndDate = { gte: toDateColumn(filter.graceEndFrom) }
    }
  } else if (filter.unpaidGraceEndBefore) {
    where.status = { not: InstallmentStatus.PAID }
    where.graceEndDate = { lt: toDateColumn(filter.unpaidGraceEndBefore) }
  } else if (filter.unpaid) {
    where.status = { not: InstallmentStatus.PAID }
  }
  return where
}
