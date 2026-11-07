import { Injectable } from '@nestjs/common'
import { Prisma, PropertyService as PropertyServiceRow } from '@prisma/client'

import {
  Currency,
  IncreaseFrequency,
  PropertyService,
  ServicePayer,
} from '@/modules/services/domain/property-service'
import {
  NewPropertyService,
  PageArgs,
  PropertyServiceChanges,
  PropertyServiceRepository,
} from '@/modules/services/domain/service.ports'
import { IsoDate } from '@/shared/dates/calendar-date'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { fromDateColumn, toDateColumn } from './date-columns'

/** Siempre `prisma.db`: tenant, auditoría y borrado lógico se aplican solos. */
@Injectable()
export class PropertyServiceRepositoryImpl extends PropertyServiceRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: NewPropertyService): Promise<PropertyService> {
    const row = await this.prisma.db.propertyService.create({
      data: {
        ...data,
        dueDate: toDateColumn(data.dueDate),
      } as Prisma.PropertyServiceUncheckedCreateInput,
    })
    return toDomain(row)
  }

  async findById(id: string): Promise<PropertyService | null> {
    const row = await this.prisma.db.propertyService.findFirst({
      where: { id },
    })
    return row ? toDomain(row) : null
  }

  async listByProperty(
    propertyId: string,
    contractId?: string,
  ): Promise<PropertyService[]> {
    const rows = await this.prisma.db.propertyService.findMany({
      where: { propertyId, ...(contractId ? { contractId } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return rows.map(toDomain)
  }

  async listForContract(
    propertyId: string,
    contractId: string,
  ): Promise<PropertyService[]> {
    const rows = await this.prisma.db.propertyService.findMany({
      where: { propertyId, OR: [{ contractId }, { contractId: null }] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return rows.map(toDomain)
  }

  async listOverdue(
    today: IsoDate,
    filter: { propertyId?: string },
    page?: PageArgs,
  ): Promise<[PropertyService[], number]> {
    const where: Prisma.PropertyServiceWhereInput = {
      hasDueDate: true,
      dueDate: { lt: toDateColumn(today) },
      ...(filter.propertyId ? { propertyId: filter.propertyId } : {}),
    }
    // Los más atrasados primero: la fecha de vencimiento más vieja.
    const orderBy: Prisma.PropertyServiceOrderByWithRelationInput[] = [
      { dueDate: 'asc' },
      { id: 'asc' },
    ]
    if (!page) {
      const rows = await this.prisma.db.propertyService.findMany({
        where,
        orderBy,
      })
      return [rows.map(toDomain), rows.length]
    }
    const [rows, total] = await this.prisma.db.$transaction([
      this.prisma.db.propertyService.findMany({ where, orderBy, ...page }),
      this.prisma.db.propertyService.count({ where }),
    ])
    return [rows.map(toDomain), total]
  }

  countByProperty(propertyId: string): Promise<number> {
    return this.prisma.db.propertyService.count({ where: { propertyId } })
  }

  async update(
    id: string,
    changes: PropertyServiceChanges,
  ): Promise<PropertyService> {
    const { dueDate, ...rest } = changes
    const row = await this.prisma.db.propertyService.update({
      where: { id },
      data: {
        ...rest,
        ...(dueDate !== undefined ? { dueDate: toDateColumn(dueDate) } : {}),
      },
    })
    return toDomain(row)
  }

  async delete(id: string): Promise<void> {
    await this.prisma.db.propertyService.delete({ where: { id } })
  }
}

function toDomain(row: PropertyServiceRow): PropertyService {
  return {
    id: row.id,
    propertyId: row.propertyId,
    contractId: row.contractId,
    serviceTypeId: row.serviceTypeId,
    // Mismos valores en los enums de Prisma y en los del dominio.
    paidBy: ServicePayer[row.paidBy],
    currency: Currency[row.currency],
    hasDueDate: row.hasDueDate,
    dueDate: fromDateColumn(row.dueDate),
    hasIncrease: row.hasIncrease,
    increaseFrequency: row.increaseFrequency
      ? IncreaseFrequency[row.increaseFrequency]
      : null,
    managedByAgency: row.managedByAgency,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
