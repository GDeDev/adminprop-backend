import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import {
  PublicInquiry,
  PublicInquirySource,
  PublicInquiryStatus,
} from '@/modules/public/domain/public-inquiry'
import {
  NewPublicInquiry,
  PublicInquiryRepository,
} from '@/modules/public/domain/public.ports'
import { PrismaService } from '@/shared/prisma/prisma.service'

type Row = Prisma.PublicInquiryGetPayload<object>

/** Siempre `prisma.db`: tenant y auditoría se aplican solos. */
@Injectable()
export class PublicInquiryRepositoryImpl extends PublicInquiryRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: NewPublicInquiry): Promise<PublicInquiry> {
    // Sin tenantId: lo completa la extensión (de ahí el cast).
    const row = await this.prisma.db.publicInquiry.create({
      data: data as Prisma.PublicInquiryUncheckedCreateInput,
    })
    return toDomain(row)
  }

  async findById(id: string): Promise<PublicInquiry | null> {
    const row = await this.prisma.db.publicInquiry.findFirst({ where: { id } })
    return row ? toDomain(row) : null
  }

  async list(
    filter: { status?: PublicInquiryStatus; propertyId?: string },
    page: { skip: number; take: number },
  ): Promise<[PublicInquiry[], number]> {
    const where: Prisma.PublicInquiryWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.propertyId ? { propertyId: filter.propertyId } : {}),
    }
    const [rows, total] = await this.prisma.db.$transaction([
      this.prisma.db.publicInquiry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...page,
      }),
      this.prisma.db.publicInquiry.count({ where }),
    ])
    return [rows.map(toDomain), total]
  }

  async updateStatus(
    id: string,
    status: PublicInquiryStatus,
  ): Promise<PublicInquiry> {
    return toDomain(
      await this.prisma.db.publicInquiry.update({
        where: { id },
        data: { status },
      }),
    )
  }

  async countSince(
    since: Date,
    by: { ip: string | null; email: string },
  ): Promise<{ byIp: number; byEmail: number }> {
    const [byIp, byEmail] = await this.prisma.db.$transaction([
      this.prisma.db.publicInquiry.count({
        // Sin IP conocida no hay nada que contar por ese lado.
        where: by.ip
          ? { ip: by.ip, createdAt: { gte: since } }
          : { id: { in: [] } },
      }),
      this.prisma.db.publicInquiry.count({
        where: { email: by.email, createdAt: { gte: since } },
      }),
    ])
    return { byIp, byEmail }
  }
}

function toDomain(row: Row): PublicInquiry {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    message: row.message,
    propertyId: row.propertyId,
    status: row.status as PublicInquiryStatus,
    source: row.source as PublicInquirySource,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
