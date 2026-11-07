import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import { PropertiesFacade } from '@/modules/properties/public'
import { addDays, daysBetween, toIsoDate } from '@/shared/dates/calendar-date'
import {
  AnalyticsRangeInvalidException,
  CrmPropertyNotFoundException,
} from '../domain/crm.exceptions'
import {
  DateRange,
  InquiryRepository,
  PropertyViewRepository,
} from '../domain/crm.ports'
import {
  CLOSED_STAGES,
  INQUIRY_SOURCES,
  INQUIRY_STAGES,
  InquirySource,
  InquiryStage,
} from '../domain/inquiry'
import { InquiryPolicy } from '../domain/inquiry.policy'
import { GetCrmOverviewQuery, GetPropertyAnalyticsQuery } from './crm.messages'

const DEFAULT_DAYS = 30
const MAX_DAYS = 366
const TOP_PROPERTIES = 5

export interface CrmOverviewView {
  openCount: number
  byStage: Record<InquiryStage, number>
  bySource: Record<InquirySource, number>
  unassignedCount: number
  averageFirstContactHours: number | null
  conversionRate: string | null
  topProperties: {
    propertyId: string
    address: string
    inquiries: number
    views: number
  }[]
}

export interface PropertyAnalyticsView {
  views: number
  inquiries: number
  byStage: Record<InquiryStage, number>
  bySource: Record<InquirySource, number>
  conversionRate: string | null
  daily: { date: string; views: number; inquiries: number }[]
}

interface Range extends DateRange {
  fromDay: string
  toDay: string
}

/** Rango por día calendario (UTC); por defecto, los últimos 30 días. */
export function resolveRange(
  from: string | undefined,
  to: string | undefined,
  now: Date = new Date(),
): Range {
  const toDay = to ?? toIsoDate(now)
  const fromDay = from ?? addDays(toDay, -(DEFAULT_DAYS - 1))
  if (fromDay > toDay || daysBetween(fromDay, toDay) >= MAX_DAYS) {
    throw new AnalyticsRangeInvalidException()
  }
  return {
    fromDay,
    toDay,
    from: new Date(`${fromDay}T00:00:00.000Z`),
    to: new Date(`${toDay}T23:59:59.999Z`),
  }
}

const sum = (counts: Record<string, number>) =>
  Object.values(counts).reduce((a, b) => a + b, 0)

@QueryHandler(GetCrmOverviewQuery)
export class GetCrmOverviewHandler implements IQueryHandler<
  GetCrmOverviewQuery,
  CrmOverviewView
> {
  constructor(
    private readonly inquiries: InquiryRepository,
    private readonly viewsRepo: PropertyViewRepository,
    private readonly properties: PropertiesFacade,
  ) {}

  async execute({ from, to }: GetCrmOverviewQuery): Promise<CrmOverviewView> {
    const range = resolveRange(from, to)
    const everything: DateRange = {
      from: new Date(0),
      to: new Date('9999-12-31T23:59:59.999Z'),
    }
    const [byStage, bySource, allTime, unassigned, deltas, perProperty, views] =
      await Promise.all([
        this.inquiries.countByStage(range),
        this.inquiries.countBySource(range),
        this.inquiries.countByStage(everything),
        this.inquiries.countUnassignedOpen(),
        this.inquiries.firstContactDeltas(range),
        this.inquiries.countsByProperty(range),
        this.viewsRepo.totalsByProperty(range.fromDay, range.toDay),
      ])

    const viewsOf = new Map(views.map((v) => [v.propertyId, v.views]))
    const top = [...perProperty]
      .sort((a, b) => b.inquiries - a.inquiries)
      .slice(0, TOP_PROPERTIES)
    const addresses = await this.properties.describe(
      top.map((t) => t.propertyId),
    )

    return {
      openCount: INQUIRY_STAGES.filter(
        (s) => !CLOSED_STAGES.includes(s),
      ).reduce((total, stage) => total + allTime[stage], 0),
      byStage,
      bySource,
      unassignedCount: unassigned,
      averageFirstContactHours: InquiryPolicy.averageHours(deltas),
      conversionRate: InquiryPolicy.conversionRate(
        byStage[InquiryStage.CLOSED_WON],
        sum(byStage),
      ),
      topProperties: top.map((entry) => ({
        propertyId: entry.propertyId,
        address: addresses.get(entry.propertyId)?.address ?? '',
        inquiries: entry.inquiries,
        views: viewsOf.get(entry.propertyId) ?? 0,
      })),
    }
  }
}

@QueryHandler(GetPropertyAnalyticsQuery)
export class GetPropertyAnalyticsHandler implements IQueryHandler<
  GetPropertyAnalyticsQuery,
  PropertyAnalyticsView
> {
  constructor(
    private readonly inquiries: InquiryRepository,
    private readonly viewsRepo: PropertyViewRepository,
    private readonly properties: PropertiesFacade,
  ) {}

  async execute({
    propertyId,
    from,
    to,
  }: GetPropertyAnalyticsQuery): Promise<PropertyAnalyticsView> {
    const range = resolveRange(from, to)
    if (!(await this.properties.describe([propertyId])).has(propertyId)) {
      throw new CrmPropertyNotFoundException(propertyId)
    }
    const [rows, dailyViews] = await Promise.all([
      this.inquiries.forProperty(propertyId, range),
      this.viewsRepo.dailyFor(propertyId, range.fromDay, range.toDay),
    ])

    const byStage = Object.fromEntries(
      INQUIRY_STAGES.map((s) => [s, 0]),
    ) as Record<InquiryStage, number>
    const bySource = Object.fromEntries(
      INQUIRY_SOURCES.map((s) => [s, 0]),
    ) as Record<InquirySource, number>
    const inquiriesPerDay = new Map<string, number>()
    for (const row of rows) {
      byStage[row.stage] += 1
      bySource[row.source] += 1
      const day = toIsoDate(row.createdAt)
      inquiriesPerDay.set(day, (inquiriesPerDay.get(day) ?? 0) + 1)
    }
    const viewsPerDay = new Map(dailyViews.map((v) => [v.day, v.views]))

    const daily: PropertyAnalyticsView['daily'] = []
    for (let day = range.fromDay; day <= range.toDay; day = addDays(day, 1)) {
      daily.push({
        date: day,
        views: viewsPerDay.get(day) ?? 0,
        inquiries: inquiriesPerDay.get(day) ?? 0,
      })
    }

    return {
      views: dailyViews.reduce((total, v) => total + v.views, 0),
      inquiries: rows.length,
      byStage,
      bySource,
      conversionRate: InquiryPolicy.conversionRate(
        byStage[InquiryStage.CLOSED_WON],
        rows.length,
      ),
      daily,
    }
  }
}
