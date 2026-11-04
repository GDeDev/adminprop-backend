import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import {
  ChannelAccountPatch,
  InquiryActivityRepository,
  ListingChannelRepository,
  ListingPatch,
  PropertyListingRepository,
  PropertyViewRepository,
} from '@/modules/crm/domain/crm.ports'
import {
  InquiryActivity,
  InquiryActivityType,
} from '@/modules/crm/domain/inquiry'
import {
  ChannelState,
  ListingChannel,
  ListingChannelAccountData,
  ListingStatus,
  PropertyListingData,
} from '@/modules/crm/domain/listing'
import { SecretBoxPort } from '@/platform/secrets/secret-box.port'
import { RequestContext } from '@/shared/context/request-context'
import { toIsoDate } from '@/shared/dates/calendar-date'
import { PrismaService } from '@/shared/prisma/prisma.service'

const asDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`)

// ------------------------------------------------------------- Actividades

@Injectable()
export class InquiryActivityRepositoryImpl extends InquiryActivityRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async add(data: {
    inquiryId: string
    type: InquiryActivityType
    authorId: string | null
    payload: Record<string, unknown>
  }): Promise<InquiryActivity> {
    const row = await this.prisma.db.inquiryActivity.create({
      data: {
        ...data,
        payload: data.payload as Prisma.InputJsonValue,
      } as Prisma.InquiryActivityUncheckedCreateInput,
    })
    return toActivity(row)
  }

  async listFor(inquiryId: string): Promise<InquiryActivity[]> {
    const rows = await this.prisma.db.inquiryActivity.findMany({
      where: { inquiryId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return rows.map(toActivity)
  }
}

function toActivity(
  row: Prisma.InquiryActivityGetPayload<object>,
): InquiryActivity {
  return {
    id: row.id,
    inquiryId: row.inquiryId,
    type: row.type as InquiryActivityType,
    authorId: row.authorId,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
  }
}

// ------------------------------------------------------------------ Vistas

@Injectable()
export class PropertyViewRepositoryImpl extends PropertyViewRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async increment(propertyId: string, day: string): Promise<void> {
    const tenantId = RequestContext.tenantId as string
    await this.prisma.db.propertyView.upsert({
      where: {
        tenantId_propertyId_day: { tenantId, propertyId, day: asDate(day) },
      },
      create: {
        propertyId,
        day: asDate(day),
        views: 1,
      } as Prisma.PropertyViewUncheckedCreateInput,
      update: { views: { increment: 1 } },
    })
  }

  async totalFor(
    propertyId: string,
    from: string,
    to: string,
  ): Promise<number> {
    const result = await this.prisma.db.propertyView.aggregate({
      where: { propertyId, day: { gte: asDate(from), lte: asDate(to) } },
      _sum: { views: true },
    })
    return result._sum.views ?? 0
  }

  async dailyFor(
    propertyId: string,
    from: string,
    to: string,
  ): Promise<{ day: string; views: number }[]> {
    const rows = await this.prisma.db.propertyView.findMany({
      where: { propertyId, day: { gte: asDate(from), lte: asDate(to) } },
      orderBy: { day: 'asc' },
    })
    return rows.map((row) => ({ day: toIsoDate(row.day), views: row.views }))
  }

  async totalsByProperty(
    from: string,
    to: string,
  ): Promise<{ propertyId: string; views: number }[]> {
    const groups = await this.prisma.db.propertyView.groupBy({
      by: ['propertyId'],
      where: { day: { gte: asDate(from), lte: asDate(to) } },
      _sum: { views: true },
    })
    return groups.map((group) => ({
      propertyId: group.propertyId,
      views: group._sum.views ?? 0,
    }))
  }
}

// ------------------------------------------------------------------ Canales

type ChannelRow = Prisma.ListingChannelAccountGetPayload<object>

@Injectable()
export class ListingChannelRepositoryImpl extends ListingChannelRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretBoxPort,
  ) {
    super()
  }

  async find(
    channel: ListingChannel,
  ): Promise<ListingChannelAccountData | null> {
    const row = await this.prisma.db.listingChannelAccount.findFirst({
      where: { channel },
    })
    return row ? this.toDomain(row) : null
  }

  async list(): Promise<ListingChannelAccountData[]> {
    const rows = await this.prisma.db.listingChannelAccount.findMany({
      orderBy: { channel: 'asc' },
    })
    return rows.map((row) => this.toDomain(row))
  }

  async listConnected(): Promise<ListingChannelAccountData[]> {
    const rows = await this.prisma.db.listingChannelAccount.findMany({
      where: { status: ChannelState.CONNECTED },
    })
    return rows.map((row) => this.toDomain(row))
  }

  async save(
    channel: ListingChannel,
    patch: ChannelAccountPatch,
  ): Promise<ListingChannelAccountData> {
    const tenantId = RequestContext.tenantId as string
    const { tokens, ...rest } = patch
    const data: Prisma.ListingChannelAccountUncheckedUpdateInput = { ...rest }
    if (tokens !== undefined) {
      data.accessTokenEnc = tokens
        ? this.secrets.seal(tokens.accessToken)
        : null
      data.refreshTokenEnc = tokens?.refreshToken
        ? this.secrets.seal(tokens.refreshToken)
        : null
      data.tokenExpiresAt = tokens?.expiresAt ?? null
    }
    const row = await this.prisma.db.listingChannelAccount.upsert({
      where: { tenantId_channel: { tenantId, channel } },
      create: {
        channel,
        ...data,
      } as Prisma.ListingChannelAccountUncheckedCreateInput,
      update: data,
    })
    return this.toDomain(row)
  }

  private toDomain(row: ChannelRow): ListingChannelAccountData {
    return {
      id: row.id,
      channel: row.channel as ListingChannel,
      status: row.status as ChannelState,
      accountLabel: row.accountLabel,
      tokens: row.accessTokenEnc
        ? {
            accessToken: this.secrets.open(row.accessTokenEnc),
            refreshToken: row.refreshTokenEnc
              ? this.secrets.open(row.refreshTokenEnc)
              : null,
            expiresAt: row.tokenExpiresAt,
          }
        : null,
      connectedAt: row.connectedAt,
      lastError: row.lastError,
      lastInquirySyncAt: row.lastInquirySyncAt,
    }
  }
}

// ------------------------------------------------------------ Publicaciones

type ListingRow = Prisma.PropertyListingGetPayload<object>

@Injectable()
export class PropertyListingRepositoryImpl extends PropertyListingRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async find(
    propertyId: string,
    channel: ListingChannel,
  ): Promise<PropertyListingData | null> {
    const row = await this.prisma.db.propertyListing.findFirst({
      where: { propertyId, channel },
    })
    return row ? toListing(row) : null
  }

  async findByExternalId(
    channel: ListingChannel,
    externalId: string,
  ): Promise<PropertyListingData | null> {
    const row = await this.prisma.db.propertyListing.findFirst({
      where: { channel, externalId },
    })
    return row ? toListing(row) : null
  }

  async listForProperty(propertyId: string): Promise<PropertyListingData[]> {
    const rows = await this.prisma.db.propertyListing.findMany({
      where: { propertyId },
      orderBy: { channel: 'asc' },
    })
    return rows.map(toListing)
  }

  async listActiveForProperty(
    propertyId: string,
  ): Promise<PropertyListingData[]> {
    const rows = await this.prisma.db.propertyListing.findMany({
      where: {
        propertyId,
        status: { in: [ListingStatus.PUBLISHED, ListingStatus.PAUSED] },
      },
    })
    return rows.map(toListing)
  }

  async upsert(
    propertyId: string,
    channel: ListingChannel,
    patch: ListingPatch,
  ): Promise<PropertyListingData> {
    const tenantId = RequestContext.tenantId as string
    const row = await this.prisma.db.propertyListing.upsert({
      where: {
        tenantId_propertyId_channel: { tenantId, propertyId, channel },
      },
      create: {
        propertyId,
        channel,
        ...patch,
      } as Prisma.PropertyListingUncheckedCreateInput,
      update: patch,
    })
    return toListing(row)
  }
}

function toListing(row: ListingRow): PropertyListingData {
  return {
    id: row.id,
    propertyId: row.propertyId,
    channel: row.channel as ListingChannel,
    externalId: row.externalId,
    externalUrl: row.externalUrl,
    status: row.status as ListingStatus,
    payloadHash: row.payloadHash,
    publishedAt: row.publishedAt,
    lastSyncedAt: row.lastSyncedAt,
    lastError: row.lastError,
  }
}
