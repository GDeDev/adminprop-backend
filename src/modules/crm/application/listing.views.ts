import { ChannelState, ListingChannel, ListingStatus } from '../domain/listing'

/** `UNAVAILABLE` sólo existe de cara a la API: es un canal sin adapter. */
export type ChannelStatusView = ChannelState | 'UNAVAILABLE'

export interface ListingChannelView {
  channel: ListingChannel
  status: ChannelStatusView
  accountLabel: string | null
  connectedAt: Date | null
  lastError: string | null
  unavailableReason: string | null
}

export interface PropertyListingView {
  channel: ListingChannel
  status: ListingStatus
  externalUrl: string | null
  publishedAt: Date | null
  lastSyncedAt: Date | null
  lastError: string | null
  hasUnpublishedChanges: boolean
  canPublish: boolean
  missingForPublish: string[]
}

export interface PullSummary {
  channels: number
  fetched: number
  created: number
  failed: number
}
