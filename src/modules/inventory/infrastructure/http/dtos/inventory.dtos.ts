import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator'

import {
  InventoryStatus,
  InventoryType,
  ItemCondition,
  MAX_ITEMS_PER_INVENTORY,
} from '@/modules/inventory/domain/inventory'
import { InventoryChange } from '@/modules/inventory/domain/inventory-comparison'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export class InventoryItemInputDto {
  @ApiPropertyOptional({
    description: 'Ausente en un ítem nuevo. Los ítems que falten se borran.',
  })
  @IsOptional()
  @IsUUID()
  id?: string

  @ApiProperty({ maxLength: 100, example: 'Cocina' })
  @IsString()
  @MinLength(1, { message: 'Cada ítem necesita categoría' })
  @MaxLength(100)
  category: string

  @ApiProperty({ maxLength: 300, example: 'Mesada y bacha' })
  @IsString()
  @MinLength(1, { message: 'Cada ítem necesita una descripción' })
  @MaxLength(300)
  description: string

  @ApiProperty({ enum: ItemCondition })
  @IsEnum(ItemCondition, { message: 'El estado del ítem no es válido' })
  condition: ItemCondition

  @ApiProperty({ type: String, nullable: true, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes: string | null
}

export class CreateInventoryDto {
  @ApiProperty({ enum: InventoryType })
  @IsEnum(InventoryType, { message: 'El tipo no es válido' })
  type: InventoryType

  @ApiPropertyOptional({ format: 'date', description: 'Por defecto, hoy.' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'La fecha tiene que ser AAAA-MM-DD' })
  date?: string

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  generalNotes?: string | null

  @ApiPropertyOptional({
    type: [InventoryItemInputDto],
    description: 'Sin ítems se precarga la plantilla estándar.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS_PER_INVENTORY)
  @ValidateNested({ each: true })
  @Type(() => InventoryItemInputDto)
  items?: InventoryItemInputDto[]
}

export class UpdateInventoryDto {
  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'La fecha tiene que ser AAAA-MM-DD' })
  date?: string

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  generalNotes?: string | null

  @ApiPropertyOptional({
    description: 'El inquilino estuvo presente y de acuerdo.',
  })
  @IsOptional()
  @IsBoolean({ message: 'tenantAcknowledged tiene que ser true o false' })
  tenantAcknowledged?: boolean

  @ApiPropertyOptional({
    type: [InventoryItemInputDto],
    description:
      'Reemplaza la lista: sin `id` es nuevo, con `id` se actualiza, los que faltan se borran junto a sus fotos.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS_PER_INVENTORY)
  @ValidateNested({ each: true })
  @Type(() => InventoryItemInputDto)
  items?: InventoryItemInputDto[]
}

export class CorrectInventoryDto {
  @ApiProperty({
    maxLength: 1000,
    example: 'El estado del piso estaba mal cargado',
  })
  @IsString()
  @MinLength(3, { message: 'Contá el motivo de la corrección' })
  @MaxLength(1000)
  reason: string
}

// ------------------------------------------------------------ Respuestas

export class InventoryPhotoDto {
  @ApiProperty() id: string
  @ApiProperty() url: string
}

export class InventoryItemDto {
  @ApiProperty() id: string
  @ApiProperty() category: string
  @ApiProperty() description: string
  @ApiProperty({ enum: ItemCondition }) condition: ItemCondition
  @ApiProperty({ type: String, nullable: true }) notes: string | null
  @ApiProperty({ type: [InventoryPhotoDto] }) photos: InventoryPhotoDto[]
}

export class InventoryPerformedByDto {
  @ApiProperty() id: string
  @ApiProperty() fullName: string
}

export class InventorySummaryDto {
  @ApiProperty() id: string
  @ApiProperty() contractId: string
  @ApiProperty({ enum: InventoryType }) type: InventoryType
  @ApiProperty({ format: 'date' }) date: string
  @ApiProperty({ enum: InventoryStatus }) status: InventoryStatus
  @ApiProperty() tenantAcknowledged: boolean
  @ApiProperty() itemCount: number
  @ApiProperty({ description: 'Ítems en mal estado' }) poorCount: number
  @ApiProperty() photoCount: number
  @ApiProperty({ type: InventoryPerformedByDto, nullable: true })
  performedBy: InventoryPerformedByDto | null
  @ApiProperty({ type: Date, nullable: true }) confirmedAt: Date | null
  @ApiProperty({ type: String, nullable: true })
  correctsInventoryId: string | null
}

export class InventoryDetailDto extends InventorySummaryDto {
  @ApiProperty({ type: String, nullable: true }) generalNotes: string | null
  @ApiProperty({ type: String, nullable: true }) correctionReason: string | null
  @ApiProperty({ type: [InventoryItemDto] }) items: InventoryItemDto[]
  @ApiProperty({
    type: [String],
    description: 'Ítems en mal estado sin fotos',
  })
  warnings: string[]
}

export class ContractInventoriesDto {
  @ApiProperty({ type: [InventorySummaryDto] })
  inventories: InventorySummaryDto[]
  @ApiProperty() canCreateDelivery: boolean
  @ApiProperty() canCreateReturn: boolean
}

export class InventoryComparisonRowDto {
  @ApiProperty() category: string
  @ApiProperty() description: string
  @ApiProperty({ enum: ItemCondition, nullable: true })
  deliveryCondition: ItemCondition | null
  @ApiProperty({ enum: ItemCondition, nullable: true })
  returnCondition: ItemCondition | null
  @ApiProperty({ enum: InventoryChange }) change: InventoryChange
  @ApiProperty({ type: String, nullable: true }) deliveryNotes: string | null
  @ApiProperty({ type: String, nullable: true }) returnNotes: string | null
  @ApiProperty({ type: [InventoryPhotoDto] })
  deliveryPhotos: InventoryPhotoDto[]
  @ApiProperty({ type: [InventoryPhotoDto] }) returnPhotos: InventoryPhotoDto[]
}

export class InventoryComparisonDto {
  @ApiProperty() hasDelivery: boolean
  @ApiProperty() hasReturn: boolean
  @ApiProperty({ type: String, format: 'date', nullable: true })
  deliveryDate: string | null
  @ApiProperty({ type: String, format: 'date', nullable: true })
  returnDate: string | null
  @ApiProperty({ type: [InventoryComparisonRowDto] })
  rows: InventoryComparisonRowDto[]
  @ApiProperty() worsenedCount: number
}
