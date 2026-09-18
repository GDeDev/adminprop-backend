import { applyDecorators, Type } from '@nestjs/common'
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger'

import { ApiSuccessDto } from '../dtos/api-response.dto'
import { PaginationMetaDto } from './pagination.dto'

/**
 * Documenta una respuesta paginada en Swagger.
 *
 * Hace falta porque OpenAPI no tiene genéricos: sin esto, un
 * `ApiSuccessDto<PaginatedResult<Propiedad>>` se documenta como `data: object`
 * y el consumidor no ve la forma real de la respuesta. Acá se arma el schema a
 * mano referenciando el modelo concreto.
 *
 * ```ts
 * @ApiPaginatedResponse(PropiedadDto, 'Listado de propiedades')
 * @Get()
 * listar(@Query() query: ListarPropiedadesDto) { ... }
 * ```
 */
export function ApiPaginatedResponse<TModel extends Type<unknown>>(
  model: TModel,
  description = 'Resultados paginados',
) {
  return applyDecorators(
    ApiExtraModels(ApiSuccessDto, PaginationMetaDto, model),
    ApiOkResponse({
      description,
      schema: {
        allOf: [
          {
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', nullable: true },
              data: {
                type: 'object',
                properties: {
                  data: {
                    type: 'array',
                    items: { $ref: getSchemaPath(model) },
                  },
                  pagination: { $ref: getSchemaPath(PaginationMetaDto) },
                },
              },
            },
          },
        ],
      },
    }),
  )
}
