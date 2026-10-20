import { Injectable } from '@nestjs/common'
import { Owner as OwnerRow, Prisma } from '@prisma/client'

import { BankAccount, fullNameOf, Owner } from '@/modules/owners/domain/owner'
import { OwnerPolicy } from '@/modules/owners/domain/owner.policy'
import {
  OwnerFilter,
  OwnerPersonalData,
  OwnerRepository,
} from '@/modules/owners/domain/owner.ports'
import { PrismaService } from '@/shared/prisma/prisma.service'

/**
 * Siempre `prisma.db`: tenant, soft delete y auditoría se aplican solos. Los
 * cambios de cuenta bancaria quedan en el historial campo por campo.
 */
@Injectable()
export class OwnerRepositoryImpl extends OwnerRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(
    data: OwnerPersonalData & { bankAccount: BankAccount },
  ): Promise<Owner> {
    const { bankAccount, ...personal } = data
    // Sin tenantId: lo completa la extensión (de ahí el cast).
    const row = await this.prisma.db.owner.create({
      data: {
        ...personal,
        searchName: OwnerPolicy.searchKey(fullNameOf(personal)),
        ...bankColumns(bankAccount),
      } as Prisma.OwnerUncheckedCreateInput,
    })
    return toDomain(row)
  }

  async findById(id: string): Promise<Owner | null> {
    const row = await this.prisma.db.owner.findFirst({ where: { id } })
    return row ? toDomain(row) : null
  }

  async findByIds(ids: string[]): Promise<Owner[]> {
    if (ids.length === 0) return []
    const rows = await this.prisma.db.owner.findMany({
      where: { id: { in: ids } },
    })
    return rows.map(toDomain)
  }

  async findByNationalId(nationalId: string): Promise<Owner | null> {
    const row = await this.prisma.db.owner.findFirst({ where: { nationalId } })
    return row ? toDomain(row) : null
  }

  async findByCbu(cbu: string): Promise<Owner[]> {
    const rows = await this.prisma.db.owner.findMany({
      where: { bankCbu: cbu },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    })
    return rows.map(toDomain)
  }

  async list(
    filter: OwnerFilter,
    page: { skip: number; take: number },
  ): Promise<[Owner[], number]> {
    const where = searchWhere(filter.search)
    const [rows, total] = await this.prisma.db.$transaction([
      this.prisma.db.owner.findMany({
        where,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
        ...page,
      }),
      this.prisma.db.owner.count({ where }),
    ])
    return [rows.map(toDomain), total]
  }

  async update(id: string, data: Partial<OwnerPersonalData>): Promise<Owner> {
    const renamed = data.firstName !== undefined || data.lastName !== undefined
    const current = renamed
      ? await this.prisma.db.owner.findFirstOrThrow({ where: { id } })
      : null
    const row = await this.prisma.db.owner.update({
      where: { id },
      data: {
        ...data,
        ...(current && {
          searchName: OwnerPolicy.searchKey(
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

  async updateBankAccount(id: string, account: BankAccount): Promise<Owner> {
    const row = await this.prisma.db.owner.update({
      where: { id },
      data: bankColumns(account),
    })
    return toDomain(row)
  }

  async setPortalUser(id: string, portalUserId: string): Promise<void> {
    await this.prisma.db.owner.update({
      where: { id },
      data: { portalUserId },
    })
  }

  async softDelete(id: string): Promise<void> {
    // La extensión de soft delete lo convierte en `deletedAt = now()`.
    await this.prisma.db.owner.delete({ where: { id } })
  }
}

/**
 * Cada palabra tiene que aparecer en el nombre completo o en el DNI: así
 * "perez juan" encuentra a Juan Pérez. Los propietarios de una inmobiliaria
 * son cientos, no millones: el índice por tenant alcanza, sin trigramas.
 */
function searchWhere(search: string | undefined): Prisma.OwnerWhereInput {
  const words = search?.trim().split(/\s+/).filter(Boolean) ?? []
  if (words.length === 0) return {}
  return {
    AND: words.map((word) => {
      const digits = word.replace(/[.-]/g, '')
      return {
        OR: [
          { searchName: { contains: OwnerPolicy.searchKey(word) } },
          ...(/^\d+$/.test(digits)
            ? [{ nationalId: { contains: digits } }]
            : []),
        ],
      }
    }),
  }
}

function bankColumns(account: BankAccount) {
  return {
    bankCbu: account.cbu,
    bankAlias: account.alias,
    bankName: account.bankName,
    bankHolder: account.holder,
  }
}

function toDomain(row: OwnerRow): Owner {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    nationalId: row.nationalId,
    phone: row.phone,
    email: row.email,
    address: row.address,
    notes: row.notes,
    bankAccount: {
      cbu: row.bankCbu,
      alias: row.bankAlias,
      bankName: row.bankName,
      holder: row.bankHolder,
    },
    portalUserId: row.portalUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
