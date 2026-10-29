import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import {
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
} from '@/modules/billing/domain/billing.ports'
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
    // Una fila por día y no un `createMany`: el `tenantId` lo completa la
    // extensión sólo en altas de primer nivel.
    for (const day of days) {
      await this.prisma.db.installmentLateFeeDay.create({
        data: {
          installmentId,
          day: toDateColumn(day.day),
          dayNumber: day.dayNumber,
          outstandingBase: day.outstandingBase,
          dailyPercentage: day.dailyPercentage,
          amount: day.amount,
        } as Prisma.InstallmentLateFeeDayUncheckedCreateInput,
      })
    }
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
