import { Injectable } from '@nestjs/common'
import { GeneratedDocument as DocumentRow, Prisma } from '@prisma/client'

import {
  DocumentData,
  DocumentKind,
  DocumentStatus,
  GeneratedDocument,
} from '@/modules/documents/domain/document'
import {
  DocumentFilter,
  GeneratedDocumentRepository,
  NewGeneratedDocument,
  ReadyFile,
} from '@/modules/documents/domain/document.ports'
import { PrismaService } from '@/shared/prisma/prisma.service'

function toDomain(row: DocumentRow): GeneratedDocument {
  return {
    id: row.id,
    kind: DocumentKind[row.kind],
    entityId: row.entityId,
    version: row.version,
    status: DocumentStatus[row.status],
    storageKey: row.storageKey,
    url: row.url,
    sizeBytes: row.sizeBytes,
    error: row.error,
    generatedAt: row.generatedAt,
    requestedById: row.requestedById,
    dataSnapshot: row.dataSnapshot as DocumentData | null,
    createdAt: row.createdAt,
  }
}

const json = (
  data: DocumentData | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  data === null ? Prisma.DbNull : (data as unknown as Prisma.InputJsonValue)

/** Siempre `prisma.db`: tenant y auditoría se aplican solos. */
@Injectable()
export class GeneratedDocumentRepositoryImpl extends GeneratedDocumentRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: NewGeneratedDocument): Promise<GeneratedDocument> {
    const row = await this.prisma.db.generatedDocument.create({
      data: {
        kind: data.kind,
        entityId: data.entityId,
        version: data.version,
        requestedById: data.requestedById,
        dataSnapshot: json(data.dataSnapshot),
      } as Prisma.GeneratedDocumentUncheckedCreateInput,
    })
    return toDomain(row)
  }

  async findById(id: string): Promise<GeneratedDocument | null> {
    const row = await this.prisma.db.generatedDocument.findFirst({
      where: { id },
    })
    return row ? toDomain(row) : null
  }

  async findLatest(
    kind: DocumentKind,
    entityId: string,
  ): Promise<GeneratedDocument | null> {
    const row = await this.prisma.db.generatedDocument.findFirst({
      where: { kind, entityId },
      orderBy: { version: 'desc' },
    })
    return row ? toDomain(row) : null
  }

  async findCurrent(
    kind: DocumentKind,
    entityId: string,
  ): Promise<GeneratedDocument | null> {
    const row = await this.prisma.db.generatedDocument.findFirst({
      where: { kind, entityId, status: 'READY' },
      orderBy: { version: 'desc' },
    })
    return row ? toDomain(row) : null
  }

  async reset(
    id: string,
    requestedById: string | null,
  ): Promise<GeneratedDocument> {
    const row = await this.prisma.db.generatedDocument.update({
      where: { id },
      data: {
        status: 'PENDING',
        error: null,
        ...(requestedById ? { requestedById } : {}),
      },
    })
    return toDomain(row)
  }

  async markReady(id: string, file: ReadyFile): Promise<GeneratedDocument> {
    const row = await this.prisma.db.generatedDocument.update({
      where: { id },
      data: {
        status: 'READY',
        storageKey: file.storageKey,
        url: file.url,
        sizeBytes: file.sizeBytes,
        generatedAt: file.generatedAt,
        error: null,
        dataSnapshot: json(file.dataSnapshot),
      },
    })
    return toDomain(row)
  }

  async markFailed(id: string, error: string): Promise<GeneratedDocument> {
    const row = await this.prisma.db.generatedDocument.update({
      where: { id },
      data: { status: 'FAILED', error },
    })
    return toDomain(row)
  }

  async list(
    filter: DocumentFilter,
    page: { skip: number; take: number },
  ): Promise<[GeneratedDocument[], number]> {
    const where: Prisma.GeneratedDocumentWhereInput = {
      ...(filter.kind ? { kind: filter.kind } : {}),
      ...(filter.entityId ? { entityId: filter.entityId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    }
    const [rows, total] = await this.prisma.db.$transaction([
      this.prisma.db.generatedDocument.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...page,
      }),
      this.prisma.db.generatedDocument.count({ where }),
    ])
    return [rows.map(toDomain), total]
  }
}
