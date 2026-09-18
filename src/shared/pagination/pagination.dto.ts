import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, Max, Min } from 'class-validator'

export const DEFAULT_PAGE = 1
export const DEFAULT_LIMIT = 20

/**
 * Techo duro de resultados por página.
 *
 * Sin esto, un `?limit=1000000` es un DoS gratis: la base arma el resultado
 * entero en memoria y el proceso se queda sin heap serializándolo a JSON.
 */
export const MAX_LIMIT = 100

/**
 * Query params de paginación. Extendelo cuando un endpoint necesite filtros:
 *
 * ```ts
 * export class ListarPropiedadesDto extends PaginationQueryDto {
 *   @IsOptional() @IsString()
 *   ciudad?: string
 * }
 * ```
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Número de página, empezando en 1',
    minimum: 1,
    default: DEFAULT_PAGE,
    example: 1,
  })
  @IsOptional()
  // Los query params llegan siempre como string; sin este Type, @IsInt falla
  // aunque el valor sea "2".
  @Type(() => Number)
  @IsInt({ message: 'page debe ser un número entero' })
  @Min(1, { message: 'page debe ser 1 o mayor' })
  page: number = DEFAULT_PAGE

  @ApiPropertyOptional({
    description: `Resultados por página (máximo ${MAX_LIMIT})`,
    minimum: 1,
    maximum: MAX_LIMIT,
    default: DEFAULT_LIMIT,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un número entero' })
  @Min(1, { message: 'limit debe ser 1 o mayor' })
  @Max(MAX_LIMIT, { message: `limit no puede superar ${MAX_LIMIT}` })
  limit: number = DEFAULT_LIMIT
}

export class PaginationMetaDto {
  @ApiProperty({ description: 'Página actual', example: 2 })
  page: number

  @ApiProperty({ description: 'Resultados por página', example: 20 })
  limit: number

  @ApiProperty({
    description: 'Total de registros que matchean la consulta',
    example: 137,
  })
  total: number

  @ApiProperty({ description: 'Cantidad total de páginas', example: 7 })
  totalPages: number

  @ApiProperty({ description: '¿Hay una página siguiente?', example: true })
  hasNextPage: boolean

  @ApiProperty({ description: '¿Hay una página anterior?', example: true })
  hasPreviousPage: boolean
}

/** Lo que devuelve un endpoint paginado. */
export interface PaginatedResult<T> {
  data: T[]
  pagination: PaginationMetaDto
}

/** Versión como clase, para que Swagger pueda referenciarla. */
export class PaginatedResponseDto<T> implements PaginatedResult<T> {
  @ApiProperty({ isArray: true, description: 'Resultados de la página actual' })
  data: T[]

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto
}
