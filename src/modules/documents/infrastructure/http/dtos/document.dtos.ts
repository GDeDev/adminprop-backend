import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsOptional, IsUUID } from 'class-validator'

import {
  DocumentKind,
  DocumentStatus,
} from '@/modules/documents/domain/document'
import { PaginationQueryDto } from '@/shared/pagination'

export class UserRefDto {
  @ApiProperty() id: string
  @ApiProperty() fullName: string
}

export class GeneratedDocumentDto {
  @ApiProperty() id: string
  @ApiProperty({ enum: DocumentKind, enumName: 'DocumentKind' })
  kind: DocumentKind
  @ApiProperty({
    description: 'La liquidación, el consolidado, el pago o el contrato',
  })
  entityId: string
  @ApiProperty({ description: 'Incremental: regenerar suma una versión' })
  version: number
  @ApiProperty({ enum: DocumentStatus, enumName: 'DocumentStatus' })
  status: DocumentStatus
  @ApiProperty({ type: String, nullable: true }) url: string | null
  @ApiProperty({ type: Number, nullable: true }) sizeBytes: number | null
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Sólo para el personal',
  })
  error: string | null
  @ApiProperty({ type: Date, nullable: true }) generatedAt: Date | null
  @ApiProperty({ type: UserRefDto, nullable: true })
  requestedBy: UserRefDto | null
  @ApiProperty() createdAt: Date
}

export class ListDocumentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DocumentKind, enumName: 'DocumentKind' })
  @IsOptional()
  @IsEnum(DocumentKind, { message: 'El tipo de documento no es válido' })
  kind?: DocumentKind

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'entityId tiene que ser un id válido' })
  entityId?: string

  @ApiPropertyOptional({ enum: DocumentStatus, enumName: 'DocumentStatus' })
  @IsOptional()
  @IsEnum(DocumentStatus, { message: 'El estado no es válido' })
  status?: DocumentStatus
}
