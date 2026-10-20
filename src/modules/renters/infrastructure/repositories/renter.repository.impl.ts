import { Injectable } from '@nestjs/common'
import { Prisma, Renter as RenterRow } from '@prisma/client'

import { Renter } from '@/modules/renters/domain/renter'
import { RenterPolicy } from '@/modules/renters/domain/renter.policy'
import {
  RenterFilter,
  RenterPersonalData,
  RenterRepository,
} from '@/modules/renters/domain/renter.ports'
import { fullNameOf, personSearchWhere } from '@/shared/people/person-policy'
import { PrismaService } from '@/shared/prisma/prisma.service'

/**
 * Siempre `prisma.db`: tenant, soft delete y auditoría se aplican solos. El
 * cambio de garante queda en el historial como cualquier otra columna.
 */
@Injectable()
export class RenterRepositoryImpl extends RenterRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: RenterPersonalData): Promise<Renter> {
    // Sin tenantId: lo completa la extensión (de ahí el cast).
    const row = await this.prisma.db.renter.create({
      data: {
        ...data,
        moveInDate: toDateColumn(data.moveInDate),
        searchName: RenterPolicy.searchKey(fullNameOf(data)),
      } as Prisma.RenterUncheckedCreateInput,
    })
    return toDomain(row)
  }

  async findById(id: string): Promise<Renter | null> {
    const row = await this.prisma.db.renter.findFirst({ where: { id } })
    return row ? toDomain(row) : null
  }

  async findByIds(ids: string[]): Promise<Renter[]> {
    if (ids.length === 0) return []
    const rows = await this.prisma.db.renter.findMany({
      where: { id: { in: ids } },
    })
    return rows.map(toDomain)
  }

  async findByNationalId(nationalId: string): Promise<Renter | null> {
    const row = await this.prisma.db.renter.findFirst({
      where: { nationalId },
    })
    return row ? toDomain(row) : null
  }

  /**
   * `paymentStatus` y `propertyId` llegan en el filtro pero todavía no
   * filtran: no hay cuotas (Fase 11) ni contratos (Fase 9) contra qué
   * cruzar. Ver D-46.
   */
  async list(
    filter: RenterFilter,
    page: { skip: number; take: number },
  ): Promise<[Renter[], number]> {
    const where: Prisma.RenterWhereInput = personSearchWhere(filter.search)
    const [rows, total] = await this.prisma.db.$transaction([
      this.prisma.db.renter.findMany({
        where,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
        ...page,
      }),
      this.prisma.db.renter.count({ where }),
    ])
    return [rows.map(toDomain), total]
  }

  async listByGuarantor(guarantorId: string): Promise<Renter[]> {
    const rows = await this.prisma.db.renter.findMany({
      where: { guarantorId },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
    })
    return rows.map(toDomain)
  }

  async countByGuarantors(
    guarantorIds: string[],
  ): Promise<Map<string, number>> {
    if (guarantorIds.length === 0) return new Map()
    const groups = await this.prisma.db.renter.groupBy({
      by: ['guarantorId'],
      where: { guarantorId: { in: guarantorIds } },
      _count: { _all: true },
    })
    return new Map(
      groups.flatMap((group) =>
        group.guarantorId ? [[group.guarantorId, group._count._all]] : [],
      ),
    )
  }

  async update(id: string, data: Partial<RenterPersonalData>): Promise<Renter> {
    const renamed = data.firstName !== undefined || data.lastName !== undefined
    const current = renamed
      ? await this.prisma.db.renter.findFirstOrThrow({ where: { id } })
      : null
    const { moveInDate, ...rest } = data
    const row = await this.prisma.db.renter.update({
      where: { id },
      data: {
        ...rest,
        ...(moveInDate !== undefined && {
          moveInDate: toDateColumn(moveInDate),
        }),
        ...(current && {
          searchName: RenterPolicy.searchKey(
            fullNameOf({
              firstName: data.firstName ?? current.firstName,
              lastName: data.lastName ?? current.lastName,
            }),
          ),
        }),
      },
    })
    return toDomain(row)
  }

  async setPortalUser(id: string, portalUserId: string): Promise<void> {
    await this.prisma.db.renter.update({
      where: { id },
      data: { portalUserId },
    })
  }

  async softDelete(id: string): Promise<void> {
    // La extensión de soft delete lo convierte en `deletedAt = now()`.
    await this.prisma.db.renter.delete({ where: { id } })
  }
}

/**
 * La columna es `DATE` (sin hora ni zona). Prisma la lee y escribe como un
 * `Date` a medianoche UTC: se convierte en el borde para que el dominio sólo
 * vea `AAAA-MM-DD` y ninguna zona horaria corra la fecha un día.
 */
function toDateColumn(value: string | null): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null
}

function fromDateColumn(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null
}

function toDomain(row: RenterRow): Renter {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    nationalId: row.nationalId,
    phone: row.phone,
    email: row.email,
    address: row.address,
    moveInDate: fromDateColumn(row.moveInDate),
    notes: row.notes,
    guarantorId: row.guarantorId,
    portalUserId: row.portalUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
