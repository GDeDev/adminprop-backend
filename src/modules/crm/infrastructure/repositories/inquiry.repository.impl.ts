import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import {
  DateRange,
  InquiryFilter,
  InquiryPatch,
  InquiryRepository,
  NewInquiry,
} from '@/modules/crm/domain/crm.ports'
import {
  CLOSED_STAGES,
  INQUIRY_SOURCES,
  INQUIRY_STAGES,
  Inquiry,
  InquirySource,
  InquiryStage,
} from '@/modules/crm/domain/inquiry'
import { toIsoDate } from '@/shared/dates/calendar-date'
import { PrismaService } from '@/shared/prisma/prisma.service'

type Row = Prisma.PublicInquiryGetPayload<object>

const SAFE_LIMIT = 5000

/** Siempre `prisma.db`: tenant, soft delete y auditoría se aplican solos. */
@Injectable()
export class InquiryRepositoryImpl extends InquiryRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: NewInquiry): Promise<Inquiry> {
    // Sin tenantId: lo completa la extensión (de ahí el cast).
    const row = await this.prisma.db.publicInquiry.create({
      data: data as Prisma.PublicInquiryUncheckedCreateInput,
    })
    return toDomain(row)
  }

  async findById(id: string): Promise<Inquiry | null> {
    const row = await this.prisma.db.publicInquiry.findFirst({ where: { id } })
    return row ? toDomain(row) : null
  }

  async update(id: string, patch: InquiryPatch): Promise<Inquiry> {
    const { nextActionAt, ...rest } = patch
    const row = await this.prisma.db.publicInquiry.update({
      where: { id },
      data: {
        ...rest,
        ...(nextActionAt !== undefined
          ? { nextActionAt: nextActionAt ? asDate(nextActionAt) : null }
          : {}),
      },
    })
    return toDomain(row)
  }

  async listByStage(
    stage: InquiryStage,
    filter: Omit<InquiryFilter, 'stage'>,
    page: { skip: number; take: number },
  ): Promise<[Inquiry[], number]> {
    const where = buildWhere({ ...filter, stage })
    const [rows, total] = await this.prisma.db.$transaction([
      this.prisma.db.publicInquiry.findMany({
        where,
        orderBy: [{ boardPosition: 'asc' }, { id: 'asc' }],
        ...page,
      }),
      this.prisma.db.publicInquiry.count({ where }),
    ])
    return [rows.map(toDomain), total]
  }

  async list(
    filter: InquiryFilter,
    page: { skip: number; take: number },
  ): Promise<[Inquiry[], number]> {
    const where = buildWhere(filter)
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

  async columnPositions(
    stage: InquiryStage,
  ): Promise<{ id: string; boardPosition: number }[]> {
    return this.prisma.db.publicInquiry.findMany({
      where: { stage },
      select: { id: true, boardPosition: true },
      orderBy: [{ boardPosition: 'asc' }, { id: 'asc' }],
    })
  }

  async setPositions(
    entries: { id: string; boardPosition: number }[],
  ): Promise<void> {
    if (entries.length === 0) return
    await this.prisma.db.$transaction(
      entries.map(({ id, boardPosition }) =>
        this.prisma.db.publicInquiry.update({
          where: { id },
          data: { boardPosition },
        }),
      ),
    )
  }

  async minPosition(stage: InquiryStage): Promise<number | null> {
    const result = await this.prisma.db.publicInquiry.aggregate({
      where: { stage },
      _min: { boardPosition: true },
    })
    return result._min.boardPosition
  }

  async findByExternalId(
    source: InquirySource,
    externalId: string,
  ): Promise<Inquiry | null> {
    const row = await this.prisma.db.publicInquiry.findFirst({
      where: { source, externalId },
    })
    return row ? toDomain(row) : null
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

  async listFollowUpsDue(day: string): Promise<Inquiry[]> {
    const rows = await this.prisma.db.publicInquiry.findMany({
      where: {
        nextActionAt: { lte: asDate(day) },
        stage: { notIn: [...CLOSED_STAGES] },
      },
      orderBy: [{ nextActionAt: 'asc' }, { id: 'asc' }],
      take: SAFE_LIMIT,
    })
    return rows.map(toDomain)
  }

  // ------------------------------------------------------------- Analítica

  async countByStage(range: DateRange): Promise<Record<InquiryStage, number>> {
    const groups = await this.prisma.db.publicInquiry.groupBy({
      by: ['stage'],
      where: { createdAt: { gte: range.from, lte: range.to } },
      _count: { _all: true },
    })
    const result = zeroed(INQUIRY_STAGES)
    for (const group of groups) result[group.stage] = group._count._all
    return result
  }

  async countBySource(
    range: DateRange,
  ): Promise<Record<InquirySource, number>> {
    const groups = await this.prisma.db.publicInquiry.groupBy({
      by: ['source'],
      where: { createdAt: { gte: range.from, lte: range.to } },
      _count: { _all: true },
    })
    const result = zeroed(INQUIRY_SOURCES)
    for (const group of groups) result[group.source] = group._count._all
    return result
  }

  countUnassignedOpen(): Promise<number> {
    return this.prisma.db.publicInquiry.count({
      where: { assignedToId: null, stage: { notIn: [...CLOSED_STAGES] } },
    })
  }

  async firstContactDeltas(range: DateRange): Promise<number[]> {
    const rows = await this.prisma.db.publicInquiry.findMany({
      where: {
        createdAt: { gte: range.from, lte: range.to },
        lastContactAt: { not: null },
      },
      select: { createdAt: true, lastContactAt: true },
      take: SAFE_LIMIT,
    })
    return rows.map((row) =>
      Math.max(
        0,
        (row.lastContactAt as Date).getTime() - row.createdAt.getTime(),
      ),
    )
  }

  async countsByProperty(
    range: DateRange,
  ): Promise<{ propertyId: string; inquiries: number }[]> {
    const groups = await this.prisma.db.publicInquiry.groupBy({
      by: ['propertyId'],
      where: {
        propertyId: { not: null },
        createdAt: { gte: range.from, lte: range.to },
      },
      _count: { _all: true },
    })
    return groups.map((group) => ({
      propertyId: group.propertyId as string,
      inquiries: group._count._all,
    }))
  }

  async forProperty(
    propertyId: string,
    range: DateRange,
  ): Promise<
    { stage: InquiryStage; source: InquirySource; createdAt: Date }[]
  > {
    const rows = await this.prisma.db.publicInquiry.findMany({
      where: { propertyId, createdAt: { gte: range.from, lte: range.to } },
      select: { stage: true, source: true, createdAt: true },
      take: SAFE_LIMIT,
    })
    return rows.map((row) => ({
      stage: row.stage as InquiryStage,
      source: row.source as InquirySource,
      createdAt: row.createdAt,
    }))
  }
}

function buildWhere(filter: InquiryFilter): Prisma.PublicInquiryWhereInput {
  const q = filter.q?.trim()
  return {
    ...(filter.stage ? { stage: filter.stage } : {}),
    ...(filter.unassigned
      ? { assignedToId: null }
      : filter.assignedToId
        ? { assignedToId: filter.assignedToId }
        : {}),
    ...(filter.propertyId ? { propertyId: filter.propertyId } : {}),
    ...(filter.source ? { source: filter.source } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
            { message: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }
}

function zeroed<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>
}

function asDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`)
}

function toDomain(row: Row): Inquiry {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    message: row.message,
    propertyId: row.propertyId,
    source: row.source as InquirySource,
    stage: row.stage as InquiryStage,
    stageChangedAt: row.stageChangedAt,
    boardPosition: row.boardPosition,
    assignedToId: row.assignedToId,
    nextActionAt: row.nextActionAt ? toIsoDate(row.nextActionAt) : null,
    lastContactAt: row.lastContactAt,
    lostReason: row.lostReason,
    closedAt: row.closedAt,
    contractId: row.contractId,
    externalId: row.externalId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
