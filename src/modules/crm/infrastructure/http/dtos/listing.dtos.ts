import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength } from 'class-validator'

import { ListingChannel, ListingStatus } from '../../../domain/listing'

export class CallbackQueryDto {
  @ApiPropertyOptional({ description: 'Código de autorización del portal' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  code?: string

  @ApiProperty({ description: 'State firmado que devolvió `connect`' })
  @IsString()
  @MaxLength(4000)
  state: string

  @ApiPropertyOptional({
    description: 'El portal avisa que el usuario no autorizó',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  error?: string
}

export class ListingChannelDto {
  @ApiProperty({ enum: ListingChannel }) channel: ListingChannel
  @ApiProperty({
    enum: ['DISCONNECTED', 'CONNECTED', 'ERROR', 'UNAVAILABLE'],
  })
  status: string
  @ApiProperty({ type: String, nullable: true }) accountLabel: string | null
  @ApiProperty({ type: Date, nullable: true }) connectedAt: Date | null
  @ApiProperty({ type: String, nullable: true }) lastError: string | null
  @ApiProperty({ type: String, nullable: true })
  unavailableReason: string | null
}

export class ConnectChannelResultDto {
  @ApiProperty() authorizeUrl: string
}

export class PropertyListingDto {
  @ApiProperty({ enum: ListingChannel }) channel: ListingChannel
  @ApiProperty({ enum: ListingStatus }) status: ListingStatus
  @ApiProperty({ type: String, nullable: true }) externalUrl: string | null
  @ApiProperty({ type: Date, nullable: true }) publishedAt: Date | null
  @ApiProperty({ type: Date, nullable: true }) lastSyncedAt: Date | null
  @ApiProperty({ type: String, nullable: true }) lastError: string | null
  @ApiProperty() hasUnpublishedChanges: boolean
  @ApiProperty({
    description:
      'Canal disponible, cuenta conectada y la propiedad lista para publicarse',
  })
  canPublish: boolean
  @ApiProperty({ type: [String] }) missingForPublish: string[]
}

export class StartListingResultDto {
  @ApiProperty() jobId: string
}
