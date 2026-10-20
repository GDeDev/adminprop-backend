import { Injectable } from '@nestjs/common'
import { Guarantor as GuarantorRow, Prisma } from '@prisma/client'

import { GuaranteeType, Guarantor } from '@/modules/renters/domain/guarantor'
import { GuarantorPolicy } from '@/modules/renters/domain/guarantor.policy'
import {
  GuarantorData,
  GuarantorFilter,
  GuarantorRepository,
} from '@/modules/renters/domain/guarantor.ports'
import { fullNameOf, personSearchWhere } from '@/shared/people/person-policy'
import { PrismaService } from '@/shared/prisma/prisma.service'

/** Siempre `prisma.db`: tenant, soft delete y auditoría se aplican solos. */
@Injectable()
export class GuarantorRepositoryImpl extends GuarantorRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: GuarantorData): Promise<Guarantor> {
    // Sin tenantId: lo completa la extensión (de ahí el cast).
    const row = await this.prisma.db.guarantor.create({
      data: {
        ...data,
        searchName: GuarantorPolicy.searchKey(fullNameOf(data)),
      } as Prisma.GuarantorUncheckedCreateInput,
    })
    return toDomain(row)
  }

  async findById(id: string): Promise<Guarantor | null> {
    const row = await this.prisma.db.guarantor.findFirst({ where: { id } })
    return row ? toDomain(row) : null
  }

  async findByIds(ids: string[]): Promise<Guarantor[]> {
    if (ids.length === 0) return []
    const rows = await this.prisma.db.guarantor.findMany({
      where: { id: { in: ids } },
    })
    return rows.map(toDomain)
  }

  async findByNationalId(nationalId: string): Promise<Guarantor | null> {
    const row = await this.prisma.db.guarantor.findFirst({
      where: { nationalId },
    })
    return row ? toDomain(row) : null
  }

  async list(
    filter: GuarantorFilter,
    page: { skip: number; take: number },
  ): Promise<[Guarantor[], number]> {
    const where: Prisma.GuarantorWhereInput = personSearchWhere(filter.search)
    const [rows, total] = await this.prisma.db.$transaction([
      this.prisma.db.guarantor.findMany({
        where,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
        ...page,
      }),
      this.prisma.db.guarantor.count({ where }),
    ])
    return [rows.map(toDomain), total]
  }

  async update(id: string, data: Partial<GuarantorData>): Promise<Guarantor> {
    const renamed = data.firstName !== undefined || data.lastName !== undefined
    const current = renamed
      ? await this.prisma.db.guarantor.findFirstOrThrow({ where: { id } })
      : null
    const row = await this.prisma.db.guarantor.update({
      where: { id },
      data: {
        ...data,
        ...(current && {
          searchName: GuarantorPolicy.searchKey(
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

  async softDelete(id: string): Promise<void> {
    // La extensión de soft delete lo convierte en `deletedAt = now()`.
    await this.prisma.db.guarantor.delete({ where: { id } })
  }
}

function toDomain(row: GuarantorRow): Guarantor {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    nationalId: row.nationalId,
    phone: row.phone,
    email: row.email,
    address: row.address,
    // Mismos valores en el enum de Prisma y en el del dominio.
    guaranteeType: GuaranteeType[row.guaranteeType],
    guaranteeDetail: row.guaranteeDetail,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
