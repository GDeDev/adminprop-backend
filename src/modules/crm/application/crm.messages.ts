import { ContactChannel, InquirySource, InquiryStage } from '../domain/inquiry'
import { ListingChannel } from '../domain/listing'

// ------------------------------------------------------------------ Consultas

export interface CreateInquiryInput {
  name: string
  email?: string
  phone?: string
  message?: string
  propertyId?: string
  source: InquirySource
  assignedToId?: string
}

export class CreateInquiryCommand {
  constructor(public readonly input: CreateInquiryInput) {}
}

export class UpdateInquiryCommand {
  constructor(
    public readonly id: string,
    public readonly patch: {
      name?: string
      email?: string
      phone?: string
      propertyId?: string
      nextActionAt?: string | null
    },
  ) {}
}

export class MoveInquiryCommand {
  constructor(
    public readonly id: string,
    public readonly move: {
      stage: InquiryStage
      beforeId?: string
      afterId?: string
      lostReason?: string
      contractId?: string
    },
  ) {}
}

export class AssignInquiryCommand {
  constructor(
    public readonly id: string,
    public readonly userId: string | null,
  ) {}
}

export class AddInquiryNoteCommand {
  constructor(
    public readonly id: string,
    public readonly body: string,
  ) {}
}

export class RecordContactAttemptCommand {
  constructor(
    public readonly id: string,
    public readonly channel: ContactChannel,
  ) {}
}

export interface PipelineFilterInput {
  assignedToId?: string
  propertyId?: string
  source?: InquirySource
  q?: string
  unassigned?: boolean
}

export class GetPipelineQuery {
  constructor(public readonly filter: PipelineFilterInput) {}
}

export class ListInquiriesQuery {
  constructor(
    public readonly filter: PipelineFilterInput & { stage?: InquiryStage },
    public readonly page: { page?: number; limit?: number },
  ) {}
}

export class GetInquiryQuery {
  constructor(public readonly id: string) {}
}

export class GetWhatsAppLinkQuery {
  constructor(
    public readonly id: string,
    public readonly templateKey: string | undefined,
  ) {}
}

export class ListAssigneesQuery {}

export class GetCrmOverviewQuery {
  constructor(
    public readonly from: string | undefined,
    public readonly to: string | undefined,
  ) {}
}

export class GetPropertyAnalyticsQuery {
  constructor(
    public readonly propertyId: string,
    public readonly from: string | undefined,
    public readonly to: string | undefined,
  ) {}
}

// ------------------------------------------------------------ Multipublicación

export class ListChannelsQuery {}

export class ConnectChannelCommand {
  constructor(public readonly channel: ListingChannel) {}
}

export class DisconnectChannelCommand {
  constructor(public readonly channel: ListingChannel) {}
}

export class CompleteChannelOAuthCommand {
  constructor(
    public readonly channel: ListingChannel,
    public readonly code: string,
    public readonly state: string,
  ) {}
}

export class ListPropertyListingsQuery {
  constructor(public readonly propertyId: string) {}
}

export class PublishListingCommand {
  constructor(
    public readonly propertyId: string,
    public readonly channel: ListingChannel,
    /** `retry` reusa el mismo job pero exige que esté en error. */
    public readonly retry: boolean,
  ) {}
}

export class ChangeListingStatusCommand {
  constructor(
    public readonly propertyId: string,
    public readonly channel: ListingChannel,
    public readonly action: 'pause' | 'resume' | 'close',
  ) {}
}
